import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { googleProvisioningSource, withTestAuth } from "../test/with-test-auth.ts";
import { createRequireSession } from "./session.ts";

describe("createRequireSession", () => {
  test("returns 401 with {error:'unauthorized'} for an unauthenticated request", async () => {
    await withTestAuth({}, async ({ auth }) => {
      const app = new Hono()
        .use("*", createRequireSession(auth))
        .get("/me", (c) => c.json({ ok: true }));
      const res = await app.request("/me");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    });
  });

  test("passes through and sets the user on context for an authenticated request", async () => {
    await withTestAuth(
      { allowedEmails: "basile@example.com" },
      async ({ auth, signSessionCookie }) => {
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
          .use("*", createRequireSession(auth))
          .get("/me", (c) => c.json({ userId: c.get("user").id }));

        const res = await app.request("/me", {
          headers: { cookie: `Hejmly.session_token=${signed}` },
        });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ userId: user.id });
      },
    );
  });
});
