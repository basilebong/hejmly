import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuditEntry, AuditRecorder } from "../audit/recorder.ts";
import type { Auth } from "../auth/index.ts";
import { oauthClients, oauthConsents } from "../auth/schema.ts";
import type { Db } from "../db/index.ts";
import { createRequireSession, type SessionVariables } from "../middleware/session.ts";
import { googleProvisioningSource, withTestAuth } from "../test/index.ts";
import { createAssistantsRoutes } from "./routes.ts";
import { createAssistantsService } from "./service.ts";

const TEST_EMAIL = "basile@example.com";

const createCapturingAudit = (): { audit: AuditRecorder; entries: AuditEntry[] } => {
  const entries: AuditEntry[] = [];
  return {
    entries,
    audit: {
      async record(entry) {
        entries.push(entry);
      },
    },
  };
};

const seedSessionCookie = async (
  auth: Auth,
  signSessionCookie: (token: string) => Promise<string>,
  email: string,
): Promise<{ userId: string; cookie: string }> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name: "Basile", email },
    googleProvisioningSource,
  );
  const session = await ctx.internalAdapter.createSession(user.id);
  const signed = await signSessionCookie(session.token);
  return { userId: user.id, cookie: `Hejmly.session_token=${signed}` };
};

const seedConsent = async (
  db: Db,
  opts: { id: string; clientId: string; name: string; userId: string; connectedAt: Date },
): Promise<void> => {
  await db.insert(oauthClients).values({
    id: `client-row-${opts.clientId}`,
    clientId: opts.clientId,
    name: opts.name,
    redirectUris: ["https://example.com/cb"],
    createdAt: opts.connectedAt,
  });
  await db.insert(oauthConsents).values({
    id: opts.id,
    clientId: opts.clientId,
    userId: opts.userId,
    scopes: ["openid", "mcp"],
    createdAt: opts.connectedAt,
    updatedAt: opts.connectedAt,
  });
};

type TestApp = Hono<{ Variables: SessionVariables }>;

const buildApp = (auth: Auth, db: Db, audit: AuditRecorder): TestApp =>
  new Hono<{ Variables: SessionVariables }>()
    .use("/api/*", createRequireSession(auth))
    .route(
      "/api/me/assistants",
      createAssistantsRoutes({ service: createAssistantsService(db), audit }),
    );

describe("assistants routes", () => {
  test("GET /api/me/assistants requires a session", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const { audit } = createCapturingAudit();
      const app = buildApp(auth, db, audit);
      const res = await app.request("/api/me/assistants");
      expect(res.status).toBe(401);
    });
  });

  test("GET /api/me/assistants returns the signed-in user's assistants", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db, signSessionCookie }) => {
      const { userId, cookie } = await seedSessionCookie(auth, signSessionCookie, TEST_EMAIL);
      await seedConsent(db, {
        id: "consent-1",
        clientId: "claude-client",
        name: "Claude",
        userId,
        connectedAt: new Date("2026-05-12T10:00:00.000Z"),
      });
      const { audit } = createCapturingAudit();
      const app = buildApp(auth, db, audit);

      const res = await app.request("/api/me/assistants", { headers: { cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        assistants: [
          {
            id: "consent-1",
            clientId: "claude-client",
            name: "Claude",
            connectedAt: new Date("2026-05-12T10:00:00.000Z").getTime(),
          },
        ],
      });
    });
  });

  test("POST /api/me/assistants/:id/revoke revokes and records an audit entry", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db, signSessionCookie }) => {
      const { userId, cookie } = await seedSessionCookie(auth, signSessionCookie, TEST_EMAIL);
      await seedConsent(db, {
        id: "consent-1",
        clientId: "claude-client",
        name: "Claude",
        userId,
        connectedAt: new Date("2026-05-12T10:00:00.000Z"),
      });
      const { audit, entries } = createCapturingAudit();
      const app = buildApp(auth, db, audit);

      const res = await app.request("/api/me/assistants/consent-1/revoke", {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "consent-1" });

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        userId,
        action: "assistant.revoke",
        via: "web",
        metadata: { clientId: "claude-client" },
      });

      const list = await app.request("/api/me/assistants", { headers: { cookie } });
      expect(await list.json()).toEqual({ assistants: [] });
    });
  });

  test("POST revoke for an unknown consent returns 404 and records nothing", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db, signSessionCookie }) => {
      const { cookie } = await seedSessionCookie(auth, signSessionCookie, TEST_EMAIL);
      const { audit, entries } = createCapturingAudit();
      const app = buildApp(auth, db, audit);

      const res = await app.request("/api/me/assistants/does-not-exist/revoke", {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(404);
      expect(entries).toHaveLength(0);
    });
  });
});
