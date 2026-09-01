import { describe, expect, test } from "bun:test";
import type { CleanupScheduler } from "@hejmly/app-grocery/server";
import { createGroceryService } from "@hejmly/app-grocery/server";
import { createRecipeService } from "@hejmly/app-recipes/server";
import { createAssistantsService, createAuditRecorder, type Db } from "@hejmly/core/server";
import { googleProvisioningSource, withTestAuth } from "@hejmly/core/server/test";
import { type AppType, createApp } from "./composition.ts";

const noopCleanup: CleanupScheduler = {
  schedule: async () => {},
  cancel: async () => {},
  close: async () => {},
};

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const pkce = async (): Promise<{ verifier: string; challenge: string }> => {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
};

const jwtClaims = (token: string): { sub: unknown; iss: unknown; aud: unknown } => {
  const part = token.split(".")[1] ?? "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const parsed: unknown = JSON.parse(atob(padded));
  if (parsed === null || typeof parsed !== "object") throw new Error("bad jwt payload");
  return {
    sub: "sub" in parsed ? parsed.sub : undefined,
    iss: "iss" in parsed ? parsed.iss : undefined,
    aud: "aud" in parsed ? parsed.aud : undefined,
  };
};

const dataPayload = (sseOrJson: string): unknown => {
  const line = sseOrJson.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line === undefined ? sseOrJson : line.slice("data:".length).trim());
};

const firstConsentId = (payload: unknown): string => {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "assistants" in payload &&
    Array.isArray(payload.assistants)
  ) {
    const first: unknown = payload.assistants[0];
    if (
      first !== null &&
      typeof first === "object" &&
      "id" in first &&
      typeof first.id === "string"
    ) {
      return first.id;
    }
  }
  throw new Error("expected at least one connected assistant");
};

type McpHarness = { baseURL: string; cookie: string; userId: string; db: Db };

const withMcpServer = async (run: (h: McpHarness) => Promise<void>): Promise<void> => {
  let app: AppType | undefined;
  const server = Bun.serve({
    port: 0,
    fetch: (req) => app?.fetch(req) ?? new Response("not ready", { status: 503 }),
  });
  const baseURL = `http://localhost:${server.port}`;
  try {
    await withTestAuth(
      { allowedEmails: "basile@example.com", baseURL },
      async ({ auth, db, signSessionCookie }) => {
        const adapter = await auth.$context;
        const user = await adapter.internalAdapter.createUser(
          {
            name: "Basile",
            email: "basile@example.com",
          },
          googleProvisioningSource,
        );
        const session = await adapter.internalAdapter.createSession(user.id);
        const cookie = `Hejmly.session_token=${await signSessionCookie(session.token)}`;

        app = createApp({
          auth,
          db,
          baseURL,
          jwksOrigin: baseURL,
          allowedHosts: [`localhost:${server.port}`],
          staticRoot: "/nonexistent/hejmly-web-dist",
          audit: createAuditRecorder(db),
          assistants: { service: createAssistantsService(db) },
          grocery: { service: createGroceryService(db), cleanup: noopCleanup },
          recipes: { service: createRecipeService(db) },
        });

        await run({ baseURL, cookie, userId: user.id, db });
      },
    );
  } finally {
    await server.stop(true);
  }
};

type OAuthGrant = { clientId: string; accessToken: string };

const runClaudeOAuthFlow = async (baseURL: string, cookie: string): Promise<OAuthGrant> => {
  const redirectUri = `${baseURL}/oauth/callback`;
  const resource = `${baseURL}/mcp`;

  const register = await fetch(`${baseURL}/api/auth/oauth2/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [redirectUri],
      // Better Auth 1.7 enforces OIDC DCR application_type rules: a "web" client
      // (the default) may only use https redirect URIs on non-loopback hosts.
      // This flow redirects to http://localhost, which is a native client.
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "openid profile email",
    }),
  });
  // RFC 7591 §3.2.1: a successful Dynamic Client Registration returns 201 Created.
  if (register.status !== 201) throw new Error(`register failed: ${register.status}`);
  const clientId: unknown = (await register.json()).client_id;
  if (typeof clientId !== "string") throw new Error("missing client_id");

  const { verifier, challenge } = await pkce();
  const authorize = await fetch(
    `${baseURL}/api/auth/oauth2/authorize?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile email",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      resource,
    })}`,
    { headers: { cookie }, redirect: "manual" },
  );
  if (authorize.status !== 302) throw new Error(`authorize failed: ${authorize.status}`);
  const location = authorize.headers.get("location") ?? "";
  if (!location.includes("/consent")) throw new Error(`unexpected redirect: ${location}`);
  const oauthQuery = location.slice(location.indexOf("?") + 1);

  const consent = await fetch(`${baseURL}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: baseURL },
    body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
  });
  if (consent.status !== 200) throw new Error(`consent failed: ${consent.status}`);
  const code = new URL((await consent.json()).url).searchParams.get("code");
  if (code === null) throw new Error("missing authorization code");

  const token = await fetch(`${baseURL}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }).toString(),
  });
  if (token.status !== 200) throw new Error(`token failed: ${token.status}`);
  const accessToken: unknown = (await token.json()).access_token;
  if (typeof accessToken !== "string") throw new Error("missing access_token");

  return { clientId, accessToken };
};

const callMcp = (baseURL: string, accessToken: string, body: unknown): Promise<Response> =>
  fetch(`${baseURL}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

describe("MCP over OAuth (end-to-end)", () => {
  test("Claude-style DCR + PKCE + consent + token grants access to grocery tools", async () => {
    await withMcpServer(async ({ baseURL, cookie, userId, db }) => {
      const { accessToken } = await runClaudeOAuthFlow(baseURL, cookie);

      const claims = jwtClaims(accessToken);
      expect(claims.sub).toBe(userId);
      expect(claims.iss).toBe(`${baseURL}/api/auth`);
      expect(Array.isArray(claims.aud) ? claims.aud : []).toContain(`${baseURL}/mcp`);

      const unauthorized = await fetch(`${baseURL}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(unauthorized.status).toBe(401);

      const call = await callMcp(baseURL, accessToken, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "grocery__add_item", arguments: { name: "Milk via Claude" } },
      });
      expect(call.status).toBe(200);
      const payload = dataPayload(await call.text());
      expect(JSON.stringify(payload)).toContain("Milk via Claude");

      const items = db.$client.query("SELECT name FROM grocery_items").all();
      expect(items).toEqual([{ name: "Milk via Claude" }]);
      const audit = db.$client.query("SELECT action, via FROM audit_log").all();
      expect(audit).toEqual([{ action: "grocery__add_item", via: "mcp" }]);
    });
  });

  test("revoking an assistant removes the consent but the live JWT survives its TTL window", async () => {
    await withMcpServer(async ({ baseURL, cookie }) => {
      const { accessToken } = await runClaudeOAuthFlow(baseURL, cookie);

      const before = await callMcp(baseURL, accessToken, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      expect(before.status).toBe(200);

      const list = await fetch(`${baseURL}/api/me/assistants`, { headers: { cookie } });
      expect(list.status).toBe(200);
      const consentId = firstConsentId(await list.json());

      const revoke = await fetch(`${baseURL}/api/me/assistants/${consentId}/revoke`, {
        method: "POST",
        headers: { cookie },
      });
      expect(revoke.status).toBe(200);
      expect(await revoke.json()).toEqual({ id: consentId });

      const afterList = await fetch(`${baseURL}/api/me/assistants`, { headers: { cookie } });
      expect(await afterList.json()).toEqual({ assistants: [] });

      const afterRevoke = await callMcp(baseURL, accessToken, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      expect(afterRevoke.status).toBe(200);
    });
  });
});
