import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CleanupScheduler, GroceryAnnouncer } from "@hejmly/app-grocery/server";
import { createGroceryService } from "@hejmly/app-grocery/server";
import { createRecipeService } from "@hejmly/app-recipes/server";
import { createTodoService } from "@hejmly/app-todo/server";
import type { Auth, Db } from "@hejmly/core/server";
import {
  createAssistantsService,
  createAuditRecorder,
  createPushService,
} from "@hejmly/core/server";
import { googleProvisioningSource, withTestAuth } from "@hejmly/core/server/test";
import { createApp } from "./composition.ts";

const noopCleanup: CleanupScheduler = {
  schedule: async () => {},
  cancel: async () => {},
  close: async () => {},
};

const noopAnnouncer: GroceryAnnouncer = {
  async itemAdded() {},
  async close() {},
};

const pushFor = (db: Db) => ({
  service: createPushService(db, {
    isMember: () => true,
    subject: "https://hejmly.example",
    send: async () => ({ status: 201 }),
  }),
});

let distRoot: string;

beforeAll(() => {
  distRoot = mkdtempSync(join(tmpdir(), "hejmly-compose-dist-"));
  mkdirSync(join(distRoot, "assets"));
  writeFileSync(join(distRoot, "index.html"), "<!doctype html><title>hejmly</title>");
});

afterAll(() => {
  rmSync(distRoot, { recursive: true, force: true });
});

const groceryFor = (db: Db) => ({
  service: createGroceryService(db),
  cleanup: noopCleanup,
  announcer: noopAnnouncer,
});

const appFor = (auth: Auth, db: Db, baseURL = "http://localhost:5173") =>
  createApp({
    auth,
    db,
    baseURL,
    jwksOrigin: baseURL,
    allowedHosts: ["localhost", "localhost:5173"],
    audit: createAuditRecorder(db),
    assistants: { service: createAssistantsService(db) },
    grocery: groceryFor(db),
    recipes: { service: createRecipeService(db) },
    todo: { service: createTodoService(db, { isMember: () => true }) },
    push: pushFor(db),
    staticRoot: distRoot,
  });

describe("composition", () => {
  test("GET /healthz returns ok", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/healthz");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });
  });

  test("GET /api/auth/get-session returns 200 with null for anonymous request", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/api/auth/get-session");
      expect(res.status).toBe(200);
      expect(await res.json()).toBeNull();
    });
  });

  test("GET /api/me without a session returns 401", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/api/me");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });
  });

  test("GET /api/me with a valid session returns the user", async () => {
    await withTestAuth(
      { allowedEmails: "basile@example.com" },
      async ({ auth, db, signSessionCookie }) => {
        const ctx = await auth.$context;
        const user = await ctx.internalAdapter.createUser(
          {
            name: "Basile",
            email: "basile@example.com",
          },
          googleProvisioningSource,
        );
        const sessionRow = await ctx.internalAdapter.createSession(user.id);
        const signed = await signSessionCookie(sessionRow.token);

        const app = appFor(auth, db);
        const res = await app.request("/api/me", {
          headers: { cookie: `Hejmly.session_token=${signed}` },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
          user: { id: user.id, email: "basile@example.com" },
        });
      },
    );
  });

  describe("cross-site request forgery", () => {
    const APP_ORIGIN = "http://localhost:5173";

    const signedIn = async (
      auth: Auth,
      signSessionCookie: (token: string) => Promise<string>,
    ): Promise<string> => {
      const ctx = await auth.$context;
      const user = await ctx.internalAdapter.createUser(
        { name: "Basile", email: "basile@example.com" },
        googleProvisioningSource,
      );
      const sessionRow = await ctx.internalAdapter.createSession(user.id);
      return `Hejmly.session_token=${await signSessionCookie(sessionRow.token)}`;
    };

    const creates = [
      { path: "/api/todo/projects", body: { name: "Forged" } },
      { path: "/api/grocery/items", body: { name: "Forged" } },
      { path: "/api/recipes", body: { title: "Forged" } },
    ];

    test("a form-style POST from another site is refused on every app's create route", async () => {
      await withTestAuth(
        { allowedEmails: "basile@example.com" },
        async ({ auth, db, signSessionCookie }) => {
          const app = appFor(auth, db);
          const cookie = await signedIn(auth, signSessionCookie);
          for (const { path, body } of creates) {
            for (const forged of [
              { origin: "https://evil.example.com" },
              { origin: "https://sibling.localhost:5173" },
              { "sec-fetch-site": "same-site" },
              {},
            ]) {
              const res = await app.request(path, {
                method: "POST",
                headers: { cookie, "content-type": "text/plain", ...forged },
                body: JSON.stringify(body),
              });
              expect({ path, forged, status: res.status }).toEqual({ path, forged, status: 403 });
            }
          }
          expect(db.$client.query("SELECT COUNT(*) AS n FROM todo_projects").get()).toEqual({
            n: 0,
          });
          expect(db.$client.query("SELECT COUNT(*) AS n FROM grocery_items").get()).toEqual({
            n: 0,
          });
        },
      );
    });

    test("the app's own requests still go through", async () => {
      await withTestAuth(
        { allowedEmails: "basile@example.com" },
        async ({ auth, db, signSessionCookie }) => {
          const app = appFor(auth, db);
          const cookie = await signedIn(auth, signSessionCookie);

          const json = await app.request("/api/todo/projects", {
            method: "POST",
            headers: { cookie, "content-type": "application/json", origin: APP_ORIGIN },
            body: JSON.stringify({ name: "Garden" }),
          });
          expect(json.status).toBe(201);

          const bodilessFromApp = await app.request("/api/todo/projects/nope", {
            method: "DELETE",
            headers: { cookie, origin: APP_ORIGIN, "sec-fetch-site": "same-origin" },
          });
          expect(bodilessFromApp.status).toBe(404);
        },
      );
    });
  });

  test("GET /api/me/assistants without a session returns 401", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/api/me/assistants");
      expect(res.status).toBe(401);
    });
  });

  test("GET /api/me/assistants with a valid session returns an empty list initially", async () => {
    await withTestAuth(
      { allowedEmails: "basile@example.com" },
      async ({ auth, db, signSessionCookie }) => {
        const ctx = await auth.$context;
        const user = await ctx.internalAdapter.createUser(
          {
            name: "Basile",
            email: "basile@example.com",
          },
          googleProvisioningSource,
        );
        const sessionRow = await ctx.internalAdapter.createSession(user.id);
        const signed = await signSessionCookie(sessionRow.token);

        const app = appFor(auth, db);
        const res = await app.request("/api/me/assistants", {
          headers: { cookie: `Hejmly.session_token=${signed}` },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ assistants: [] });
      },
    );
  });

  test("/api/todo is gated by the session and mounted for signed-in users", async () => {
    await withTestAuth(
      { allowedEmails: "basile@example.com" },
      async ({ auth, db, signSessionCookie }) => {
        const app = appFor(auth, db);
        const anonymous = await app.request("/api/todo/projects");
        expect(anonymous.status).toBe(401);

        const ctx = await auth.$context;
        const user = await ctx.internalAdapter.createUser(
          { name: "Basile", email: "basile@example.com" },
          googleProvisioningSource,
        );
        const sessionRow = await ctx.internalAdapter.createSession(user.id);
        const signed = await signSessionCookie(sessionRow.token);
        const res = await app.request("/api/todo/projects", {
          headers: { cookie: `Hejmly.session_token=${signed}` },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ projects: [] });
      },
    );
  });

  test("GET /.well-known/oauth-protected-resource advertises the MCP resource", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/.well-known/oauth-protected-resource");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: "http://localhost:5173/mcp",
        authorization_servers: ["http://localhost:5173/api/auth"],
      });
    });
  });

  test("GET /.well-known/oauth-authorization-server publishes the issuer + endpoints", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/.well-known/oauth-authorization-server");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        issuer: "http://localhost:5173/api/auth",
        token_endpoint: "http://localhost:5173/api/auth/oauth2/token",
        registration_endpoint: "http://localhost:5173/api/auth/oauth2/register",
        code_challenge_methods_supported: ["S256"],
      });
    });
  });

  // The root-level document must be the plugin's own, not a copy of it: a copy
  // silently under-advertises whatever the plugin gains next.
  test("GET /.well-known/oauth-authorization-server re-serves the plugin's own document", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/.well-known/oauth-authorization-server");
      expect(res.status).toBe(200);
      const published = await res.json();
      const upstream = await (
        await auth.handler(
          new Request("http://localhost:5173/api/auth/.well-known/oauth-authorization-server"),
        )
      ).json();
      expect(published).toEqual(upstream);
      expect(published).toMatchObject({ issuer: "http://localhost:5173/api/auth" });
    });
  });

  test("GET /.well-known/openid-configuration re-serves the plugin's OIDC document", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/.well-known/openid-configuration");
      expect(res.status).toBe(200);
      const published = await res.json();
      const upstream = await (
        await auth.handler(
          new Request("http://localhost:5173/api/auth/.well-known/openid-configuration"),
        )
      ).json();
      expect(published).toEqual(upstream);
      expect(published).toMatchObject({ issuer: "http://localhost:5173/api/auth" });
    });
  });

  test("POST /mcp without a bearer token returns 401 with a WWW-Authenticate challenge", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", host: "localhost:5173" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
    });
  });

  test("POST /mcp from a disallowed Host is rejected by the DNS-rebinding guard", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", host: "evil.example.com" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden_host" });
    });
  });

  test("GET / serves the built index.html", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("<title>hejmly</title>");
    });
  });

  test("GET an unknown client route falls back to index.html for SPA routing", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);
      const res = await app.request("/grocery");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    });
  });

  test("the static catch-all does not shadow API or health routes", async () => {
    await withTestAuth({}, async ({ auth, db }) => {
      const app = appFor(auth, db);

      const health = await app.request("/healthz");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const me = await app.request("/api/me");
      expect(me.status).toBe(401);
    });
  });

  test("Google OAuth callback for a non-allowlisted email is rejected", async () => {
    await withTestAuth({ allowedEmails: "basile@example.com" }, async ({ auth, db }) => {
      const ctx = await auth.$context;
      await expect(
        ctx.internalAdapter.createUser(
          {
            name: "Stranger",
            email: "stranger@example.com",
          },
          googleProvisioningSource,
        ),
      ).rejects.toThrow(/allowlist/);

      const userCount = db.$client.query("SELECT COUNT(*) AS n FROM users").get();
      expect(userCount).toEqual({ n: 0 });
    });
  });
});
