import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { googleProvisioningSource, withTestAuth } from "../test/with-test-auth.ts";

const apiErrorShape = v.object({
  statusCode: v.number(),
  body: v.object({ message: v.string() }),
});
const parseApiError = (raw: unknown): v.InferOutput<typeof apiErrorShape> =>
  v.parse(apiErrorShape, raw);

describe("auth (integration)", () => {
  test("handler responds to /api/auth/get-session with a null session for an anonymous request", async () => {
    await withTestAuth({}, async ({ auth }) => {
      const res = await auth.handler(new Request("http://localhost:5173/api/auth/get-session"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toBeNull();
    });
  });

  test("user.create.before hook allows an allowlisted email", async () => {
    await withTestAuth({ allowedEmails: "basile@example.com" }, async ({ auth }) => {
      const ctx = await auth.$context;
      const user = await ctx.internalAdapter.createUser(
        {
          name: "Basile",
          email: "basile@example.com",
        },
        googleProvisioningSource,
      );
      expect(user.email).toBe("basile@example.com");
      expect(user.id).toBeString();
    });
  });

  test("session.create.before hook refuses a new session for a user who has left the allowlist", async () => {
    await withTestAuth(
      { allowedEmails: "basile@example.com,former@example.com" },
      async ({ auth, db, restart }) => {
        const ctx = await auth.$context;
        const former = await ctx.internalAdapter.createUser(
          { name: "Former", email: "former@example.com" },
          googleProvisioningSource,
        );
        const member = await ctx.internalAdapter.createUser(
          { name: "Basile", email: "basile@example.com" },
          googleProvisioningSource,
        );

        const after = await restart({ allowedEmails: "basile@example.com" }).auth.$context;
        let caught: unknown;
        try {
          await after.internalAdapter.createSession(former.id);
        } catch (e) {
          caught = e;
        }
        const apiErr = parseApiError(caught);
        expect(apiErr.statusCode).toBe(403);
        expect(apiErr.body.message).toContain("former@example.com");

        const memberSession = await after.internalAdapter.createSession(member.id);
        expect(memberSession.userId).toBe(member.id);
        expect(db.$client.query("SELECT user_id FROM sessions").all()).toEqual([
          { user_id: member.id },
        ]);
      },
    );
  });

  test("user.create.before hook rejects a non-allowlisted email", async () => {
    await withTestAuth({ allowedEmails: "basile@example.com" }, async ({ auth, db }) => {
      const ctx = await auth.$context;
      let caught: unknown;
      try {
        await ctx.internalAdapter.createUser(
          {
            name: "Stranger",
            email: "stranger@example.com",
          },
          googleProvisioningSource,
        );
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      const apiErr = parseApiError(caught);
      expect(apiErr.statusCode).toBe(403);
      expect(apiErr.body.message).toContain("stranger@example.com");

      const userCount = db.$client.query("SELECT COUNT(*) AS n FROM users").get();
      expect(userCount).toEqual({ n: 0 });
    });
  });

  test("matches allowlisted emails case-insensitively", async () => {
    await withTestAuth({ allowedEmails: "basile@example.com" }, async ({ auth }) => {
      const ctx = await auth.$context;
      const user = await ctx.internalAdapter.createUser(
        {
          name: "Basile",
          email: "Basile@EXAMPLE.com",
        },
        googleProvisioningSource,
      );
      expect(user.email.toLowerCase()).toBe("basile@example.com");
    });
  });

  test("empty allowlist denies every email", async () => {
    await withTestAuth({}, async ({ auth }) => {
      const ctx = await auth.$context;
      await expect(
        ctx.internalAdapter.createUser(
          { name: "anyone", email: "any@example.com" },
          googleProvisioningSource,
        ),
      ).rejects.toThrow();
    });
  });

  test("declares UNIQUE(providerId, accountId) on account, so auth:generate emits the index", async () => {
    await withTestAuth({}, async ({ auth }) => {
      const { account } = (await auth.$context).tables;
      expect(account?.indexes).toContainEqual({
        fields: ["providerId", "accountId"],
        unique: true,
        name: "accounts_provider_account_unique",
      });
    });
  });
});
