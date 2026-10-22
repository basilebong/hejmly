import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { googleProvisioningSource, withTestAuth } from "../test/with-test-auth.ts";
import { createRequireSession } from "./session.ts";

describe("createRequireSession", () => {
  test("returns 401 with {error:'unauthorized'} for an unauthenticated request", async () => {
    await withTestAuth({}, async ({ auth, membership }) => {
      const app = new Hono()
        .use("*", createRequireSession(auth, membership))
        .get("/me", (c) => c.json({ ok: true }));
      const res = await app.request("/me");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });
  });

  test("passes through and sets the user on context for an authenticated request", async () => {
    await withTestAuth(
      { allowedEmails: "basile@example.com" },
      async ({ auth, membership, signSessionCookie }) => {
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

        const app = new Hono<{ Variables: { user: { id: string } } }>()
          .use("*", createRequireSession(auth, membership))
          .get("/me", (c) => c.json({ userId: c.get("user").id }));

        const res = await app.request("/me", {
          headers: { cookie: `Hejmly.session_token=${signed}` },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ userId: user.id });
      },
    );
  });

  test("returns 403 for a live session whose user has left the allowlist, members unaffected", async () => {
    await withTestAuth(
      { allowedEmails: "basile@example.com,former@example.com" },
      async ({ auth, signSessionCookie, restart }) => {
        const ctx = await auth.$context;
        const cookieFor = async (email: string): Promise<string> => {
          const user = await ctx.internalAdapter.createUser(
            { name: email, email },
            googleProvisioningSource,
          );
          const sessionRow = await ctx.internalAdapter.createSession(user.id);
          return `Hejmly.session_token=${await signSessionCookie(sessionRow.token)}`;
        };
        const memberCookie = await cookieFor("basile@example.com");
        const formerCookie = await cookieFor("former@example.com");

        const after = restart({ allowedEmails: "basile@example.com" });
        const app = new Hono()
          .use("*", createRequireSession(after.auth, after.membership))
          .get("/me", (c) => c.json({ ok: true }));

        const former = await app.request("/me", { headers: { cookie: formerCookie } });
        expect(former.status).toBe(403);
        expect(await former.json()).toEqual({ error: "forbidden" });

        const member = await app.request("/me", { headers: { cookie: memberCookie } });
        expect(member.status).toBe(200);
      },
    );
  });
});
