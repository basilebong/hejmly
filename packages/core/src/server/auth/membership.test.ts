import { describe, expect, test } from "bun:test";
import { parseUserId } from "../../shared/index.ts";
import type { Db } from "../db/index.ts";
import { googleProvisioningSource, withTestAuth } from "../test/with-test-auth.ts";
import type { Auth } from "./index.ts";
import {
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  sessions,
  verifications,
} from "./schema.ts";

const MEMBER = "basile@example.com";
const FORMER = "former@example.com";

const seedUser = async (auth: Auth, email: string): Promise<string> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name: email, email },
    googleProvisioningSource,
  );
  await ctx.internalAdapter.createSession(user.id);
  return user.id;
};

const seedOAuthGrant = async (db: Db, userId: string, clientId: string): Promise<void> => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  await db.insert(oauthClients).values({
    id: crypto.randomUUID(),
    clientId,
    name: "Claude",
    redirectUris: ["http://localhost/callback"],
    createdAt: now,
    updatedAt: now,
  });
  const refreshId = crypto.randomUUID();
  await db.insert(oauthRefreshTokens).values({
    id: refreshId,
    token: `refresh-${clientId}`,
    clientId,
    userId,
    scopes: ["openid"],
    expiresAt,
    createdAt: now,
  });
  await db.insert(oauthAccessTokens).values({
    id: crypto.randomUUID(),
    token: `access-${clientId}`,
    clientId,
    userId,
    refreshId,
    scopes: ["openid"],
    expiresAt,
    createdAt: now,
  });
  await db.insert(oauthConsents).values({
    id: crypto.randomUUID(),
    clientId,
    userId,
    scopes: ["openid"],
    createdAt: now,
    updatedAt: now,
  });
};

const seedPendingCode = async (db: Db, userId: string): Promise<void> => {
  const now = new Date();
  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    identifier: `code-${userId}`,
    value: JSON.stringify({ type: "authorization_code", userId, query: {} }),
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
  });
};

const pendingCodesOf = (db: Db, userId: string): unknown =>
  db.$client
    .query(
      "SELECT COUNT(*) AS n FROM verifications WHERE CASE WHEN json_valid(value) THEN json_extract(value, '$.userId') END = ?",
    )
    .get(userId);

const rowsOwnedBy = async (db: Db, userId: string) => ({
  sessions: (await db.select().from(sessions)).filter((r) => r.userId === userId).length,
  accessTokens: (await db.select().from(oauthAccessTokens)).filter((r) => r.userId === userId)
    .length,
  refreshTokens: (await db.select().from(oauthRefreshTokens)).filter((r) => r.userId === userId)
    .length,
  consents: (await db.select().from(oauthConsents)).filter((r) => r.userId === userId).length,
});

describe("membership", () => {
  test("allowsEmail follows the allowlist, case-insensitively", async () => {
    await withTestAuth({ allowedEmails: MEMBER }, async ({ membership }) => {
      expect(membership.allowsEmail("Basile@Example.com")).toBe(true);
      expect(membership.allowsEmail(FORMER)).toBe(false);
      expect(membership.allowsEmail(undefined)).toBe(false);
    });
  });

  test("isMember is true for a user whose email is on the allowlist", async () => {
    await withTestAuth({ allowedEmails: MEMBER }, async ({ auth, membership }) => {
      const userId = await seedUser(auth, MEMBER);
      expect(await membership.isMember(parseUserId(userId))).toEqual({ kind: "ok", value: true });
    });
  });

  test("isMember is false once the user's email leaves the allowlist", async () => {
    await withTestAuth({ allowedEmails: `${MEMBER},${FORMER}` }, async ({ auth, restart }) => {
      const userId = await seedUser(auth, FORMER);
      const { membership } = restart({ allowedEmails: MEMBER });
      expect(await membership.isMember(parseUserId(userId))).toEqual({ kind: "ok", value: false });
    });
  });

  test("isMember is false for a user that does not exist", async () => {
    await withTestAuth({ allowedEmails: MEMBER }, async ({ membership }) => {
      expect(await membership.isMember(parseUserId("no-such-user"))).toEqual({
        kind: "ok",
        value: false,
      });
    });
  });

  test("revokeFormerMembers deletes a former member's sessions, OAuth tokens and consents", async () => {
    await withTestAuth({ allowedEmails: `${MEMBER},${FORMER}` }, async ({ auth, db, restart }) => {
      const memberId = await seedUser(auth, MEMBER);
      const formerId = await seedUser(auth, FORMER);
      await seedOAuthGrant(db, memberId, "client-member");
      await seedOAuthGrant(db, formerId, "client-former");

      const { membership } = restart({ allowedEmails: MEMBER });
      const result = await membership.revokeFormerMembers();

      expect(result).toEqual({ kind: "ok", value: { revoked: [parseUserId(formerId)] } });
      expect(await rowsOwnedBy(db, formerId)).toEqual({
        sessions: 0,
        accessTokens: 0,
        refreshTokens: 0,
        consents: 0,
      });
      expect(await rowsOwnedBy(db, memberId)).toEqual({
        sessions: 1,
        accessTokens: 1,
        refreshTokens: 1,
        consents: 1,
      });
      expect(db.$client.query("SELECT COUNT(*) AS n FROM users").get()).toEqual({ n: 2 });
    });
  });

  test("revokeFormerMembers is a no-op when every user is still a member", async () => {
    await withTestAuth({ allowedEmails: MEMBER }, async ({ auth, db, membership }) => {
      const memberId = await seedUser(auth, MEMBER);
      await seedOAuthGrant(db, memberId, "client-member");

      expect(await membership.revokeFormerMembers()).toEqual({
        kind: "ok",
        value: { revoked: [] },
      });
      expect(await rowsOwnedBy(db, memberId)).toEqual({
        sessions: 1,
        accessTokens: 1,
        refreshTokens: 1,
        consents: 1,
      });
    });
  });

  test("revokeFormerMembers deletes a former member's unexchanged authorization codes only", async () => {
    await withTestAuth({ allowedEmails: `${MEMBER},${FORMER}` }, async ({ auth, db, restart }) => {
      const memberId = await seedUser(auth, MEMBER);
      const formerId = await seedUser(auth, FORMER);
      await seedPendingCode(db, memberId);
      await seedPendingCode(db, formerId);
      const now = new Date();
      await db.insert(verifications).values({
        id: crypto.randomUUID(),
        identifier: "google-oauth-state",
        value: "not json",
        expiresAt: now,
        createdAt: now,
        updatedAt: now,
      });

      const { membership } = restart({ allowedEmails: MEMBER });
      expect((await membership.revokeFormerMembers()).kind).toBe("ok");

      expect(pendingCodesOf(db, formerId)).toEqual({ n: 0 });
      expect(pendingCodesOf(db, memberId)).toEqual({ n: 1 });
      expect(
        db.$client.query("SELECT COUNT(*) AS n FROM verifications WHERE value = 'not json'").get(),
      ).toEqual({ n: 1 });
    });
  });

  test("revokeFormerMembers refuses to run against an empty allowlist", async () => {
    await withTestAuth({ allowedEmails: MEMBER }, async ({ auth, db, restart }) => {
      const memberId = await seedUser(auth, MEMBER);
      await seedOAuthGrant(db, memberId, "client-member");

      const { membership } = restart({ allowedEmails: "" });
      const result = await membership.revokeFormerMembers();

      expect(result.kind === "err" ? result.error.kind : result.kind).toBe("empty_allowlist");
      expect(await rowsOwnedBy(db, memberId)).toEqual({
        sessions: 1,
        accessTokens: 1,
        refreshTokens: 1,
        consents: 1,
      });
    });
  });

  test("a former member's cached session cookie stops working once their session is revoked", async () => {
    await withTestAuth(
      { allowedEmails: `${MEMBER},${FORMER}` },
      async ({ auth, signSessionCookie, restart }) => {
        const ctx = await auth.$context;
        const cachedCookieFor = async (email: string): Promise<string> => {
          const user = await ctx.internalAdapter.createUser(
            { name: email, email },
            googleProvisioningSource,
          );
          const session = await ctx.internalAdapter.createSession(user.id);
          const token = `Hejmly.session_token=${await signSessionCookie(session.token)}`;
          const res = await auth.handler(
            new Request("http://localhost:5173/api/auth/get-session", {
              headers: { cookie: token },
            }),
          );
          const cache = res.headers
            .getSetCookie()
            .map((c) => c.split(";")[0] ?? "")
            .find((c) => c.startsWith("Hejmly.session_data="));
          if (cache === undefined) throw new Error("expected a session cache cookie");
          return `${token}; ${cache}`;
        };
        const memberCookie = await cachedCookieFor(MEMBER);
        const formerCookie = await cachedCookieFor(FORMER);

        const after = restart({ allowedEmails: MEMBER });
        expect((await after.membership.revokeFormerMembers()).kind).toBe("ok");

        const getSession = (cookie: string) =>
          after.auth.api.getSession({ headers: new Headers({ cookie }) });
        expect(await getSession(formerCookie)).toBeNull();
        expect((await getSession(memberCookie))?.user.email).toBe(MEMBER);
      },
    );
  });
});
