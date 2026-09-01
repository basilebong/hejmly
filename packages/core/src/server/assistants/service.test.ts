import { describe, expect, test } from "bun:test";
import { parseOAuthConsentId, parseUserId } from "../../shared/index.ts";
import type { Auth } from "../auth/index.ts";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from "../auth/schema.ts";
import type { Db } from "../db/index.ts";
import { googleProvisioningSource, withTestAuth } from "../test/index.ts";
import { createAssistantsService } from "./service.ts";

const TEST_EMAIL = "basile@example.com";

const seedUser = async (auth: Auth, name: string, email: string): Promise<string> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({ name, email }, googleProvisioningSource);
  return user.id;
};

const insertConsent = async (
  db: Db,
  opts: { id: string; clientId: string; clientName: string; userId: string; connectedAt: Date },
): Promise<void> => {
  await db.insert(oauthClients).values({
    id: `client-row-${opts.clientId}`,
    clientId: opts.clientId,
    name: opts.clientName,
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

const insertAccessToken = async (
  db: Db,
  opts: { id: string; clientId: string; userId: string },
): Promise<void> => {
  await db.insert(oauthAccessTokens).values({
    id: opts.id,
    token: `access-${opts.id}`,
    clientId: opts.clientId,
    userId: opts.userId,
    scopes: ["openid", "mcp"],
    createdAt: new Date("2026-05-28T08:30:00.000Z"),
    expiresAt: new Date("2026-05-28T08:45:00.000Z"),
  });
};

const insertRefreshToken = async (
  db: Db,
  opts: { id: string; clientId: string; userId: string },
): Promise<void> => {
  await db.insert(oauthRefreshTokens).values({
    id: opts.id,
    token: `refresh-${opts.id}`,
    clientId: opts.clientId,
    userId: opts.userId,
    scopes: ["openid", "mcp"],
    createdAt: new Date("2026-05-28T08:30:00.000Z"),
    expiresAt: new Date("2026-06-27T08:30:00.000Z"),
  });
};

describe("AssistantsService", () => {
  test("list returns an empty array for a user with no consents", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const userId = await seedUser(auth, "Basile", TEST_EMAIL);
      const service = createAssistantsService(db);
      const result = await service.list(parseUserId(userId));
      expect(result.kind).toBe("ok");
      if (result.kind === "ok") expect(result.value).toEqual([]);
    });
  });

  test("list surfaces the client name and connected date", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const userId = await seedUser(auth, "Basile", TEST_EMAIL);
      const connectedAt = new Date("2026-05-12T10:00:00.000Z");
      await insertConsent(db, {
        id: "consent-1",
        clientId: "claude-client",
        clientName: "Claude",
        userId,
        connectedAt,
      });

      const service = createAssistantsService(db);
      const result = await service.list(parseUserId(userId));
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") return;
      expect(result.value).toHaveLength(1);
      const assistant = result.value[0];
      expect(assistant?.name).toBe("Claude");
      expect(assistant?.clientId).toBe("claude-client");
      expect(assistant?.connectedAt).toBe(connectedAt.getTime());
    });
  });

  test("list falls back to the client id when the client has no name", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const userId = await seedUser(auth, "Basile", TEST_EMAIL);
      await db.insert(oauthClients).values({
        id: "client-row-orphan",
        clientId: "orphan-client",
        name: null,
        redirectUris: ["https://example.com/cb"],
        createdAt: new Date("2026-05-20T10:00:00.000Z"),
      });
      await db.insert(oauthConsents).values({
        id: "consent-noname",
        clientId: "orphan-client",
        userId,
        scopes: ["openid"],
        createdAt: new Date("2026-05-20T10:00:00.000Z"),
        updatedAt: new Date("2026-05-20T10:00:00.000Z"),
      });

      const service = createAssistantsService(db);
      const result = await service.list(parseUserId(userId));
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.value[0]?.name).toBe("orphan-client");
    });
  });

  test("list returns assistants most-recently-connected first", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const userId = await seedUser(auth, "Basile", TEST_EMAIL);
      await insertConsent(db, {
        id: "consent-old",
        clientId: "client-old",
        clientName: "Old",
        userId,
        connectedAt: new Date("2026-05-01T00:00:00.000Z"),
      });
      await insertConsent(db, {
        id: "consent-new",
        clientId: "client-new",
        clientName: "New",
        userId,
        connectedAt: new Date("2026-05-29T00:00:00.000Z"),
      });

      const service = createAssistantsService(db);
      const result = await service.list(parseUserId(userId));
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.value.map((a) => a.name)).toEqual(["New", "Old"]);
    });
  });

  test("list only returns consents owned by the requesting user", async () => {
    await withTestAuth({ allowedEmails: "a@example.com,b@example.com" }, async ({ auth, db }) => {
      const userA = await seedUser(auth, "A", "a@example.com");
      const userB = await seedUser(auth, "B", "b@example.com");
      await insertConsent(db, {
        id: "consent-a",
        clientId: "client-a",
        clientName: "A's Claude",
        userId: userA,
        connectedAt: new Date("2026-05-01T00:00:00.000Z"),
      });
      await insertConsent(db, {
        id: "consent-b",
        clientId: "client-b",
        clientName: "B's Claude",
        userId: userB,
        connectedAt: new Date("2026-05-02T00:00:00.000Z"),
      });

      const service = createAssistantsService(db);
      const result = await service.list(parseUserId(userA));
      if (result.kind !== "ok") throw new Error("expected ok");
      expect(result.value.map((a) => a.id)).toEqual([parseOAuthConsentId("consent-a")]);
    });
  });

  test("revoke deletes the consent and its tokens, scoped to the owner", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const userId = await seedUser(auth, "Basile", TEST_EMAIL);
      await insertConsent(db, {
        id: "consent-1",
        clientId: "claude-client",
        clientName: "Claude",
        userId,
        connectedAt: new Date("2026-05-12T10:00:00.000Z"),
      });
      await insertAccessToken(db, { id: "at-1", clientId: "claude-client", userId });
      await insertRefreshToken(db, { id: "rt-1", clientId: "claude-client", userId });

      const service = createAssistantsService(db);
      const revoked = await service.revoke(parseUserId(userId), parseOAuthConsentId("consent-1"));
      expect(revoked.kind).toBe("ok");
      if (revoked.kind === "ok") {
        expect(revoked.value.id).toBe(parseOAuthConsentId("consent-1"));
        expect(revoked.value.clientId).toBe("claude-client");
      }

      const after = await service.list(parseUserId(userId));
      if (after.kind !== "ok") throw new Error("expected ok");
      expect(after.value).toEqual([]);

      const accessTokens = await db.select().from(oauthAccessTokens);
      expect(accessTokens).toHaveLength(0);
      const refreshTokens = await db.select().from(oauthRefreshTokens);
      expect(refreshTokens).toHaveLength(0);
    });
  });

  test("revoke returns not_found for an unknown consent", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const userId = await seedUser(auth, "Basile", TEST_EMAIL);
      const service = createAssistantsService(db);
      const result = await service.revoke(parseUserId(userId), parseOAuthConsentId("nope"));
      expect(result.kind).toBe("err");
      if (result.kind === "err") expect(result.error.kind).toBe("not_found");
    });
  });

  test("revoke refuses to delete another user's consent", async () => {
    await withTestAuth({ allowedEmails: "a@example.com,b@example.com" }, async ({ auth, db }) => {
      const userA = await seedUser(auth, "A", "a@example.com");
      const userB = await seedUser(auth, "B", "b@example.com");
      await insertConsent(db, {
        id: "consent-b",
        clientId: "client-b",
        clientName: "B's Claude",
        userId: userB,
        connectedAt: new Date("2026-05-02T00:00:00.000Z"),
      });

      const service = createAssistantsService(db);
      const result = await service.revoke(parseUserId(userA), parseOAuthConsentId("consent-b"));
      expect(result.kind).toBe("err");
      if (result.kind === "err") expect(result.error.kind).toBe("not_found");

      const stillThere = await service.list(parseUserId(userB));
      if (stillThere.kind !== "ok") throw new Error("expected ok");
      expect(stillThere.value).toHaveLength(1);
    });
  });
});
