import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Auth } from "../auth/index.ts";
import { createRequireSession, type SessionVariables } from "../middleware/session.ts";
import { createTestDevice, googleProvisioningSource, withTestAuth } from "../test/index.ts";
import { createPushRoutes } from "./routes.ts";
import { createPushService, type PushRequest } from "./service.ts";

const TEST_EMAIL = "basile@example.com";

const seedSessionCookie = async (
  auth: Auth,
  signSessionCookie: (token: string) => Promise<string>,
): Promise<string> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name: "Basile", email: TEST_EMAIL },
    googleProvisioningSource,
  );
  const session = await ctx.internalAdapter.createSession(user.id);
  return `Hejmly.session_token=${await signSessionCookie(session.token)}`;
};

type Ctx = { app: Hono<{ Variables: SessionVariables }>; cookie: string; sent: PushRequest[] };

const withRoutes = async (fn: (ctx: Ctx) => Promise<void>): Promise<void> => {
  await withTestAuth(
    { allowedEmails: TEST_EMAIL },
    async ({ auth, membership, db, signSessionCookie }) => {
      const cookie = await seedSessionCookie(auth, signSessionCookie);
      const sent: PushRequest[] = [];
      const service = createPushService(db, {
        isMember: () => true,
        subject: "https://hejmly.example",
        send: async (req) => {
          sent.push(req);
          return { status: 201 };
        },
      });
      const app = new Hono<{ Variables: SessionVariables }>()
        .use("/api/*", createRequireSession(auth, membership))
        .route("/api/push", createPushRoutes({ service }));
      await fn({ app, cookie, sent });
    },
  );
};

const send = (ctx: Ctx, method: string, path: string, body?: unknown) =>
  Promise.resolve(
    ctx.app.request(path, {
      method,
      headers: { cookie: ctx.cookie, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1";

describe("push routes", () => {
  test("every route needs a session", async () => {
    await withRoutes(async (ctx) => {
      const anonymous = { ...ctx, cookie: "" };
      for (const [method, path] of [
        ["GET", "/api/push/vapid-public-key"],
        ["POST", "/api/push/subscriptions"],
        ["POST", "/api/push/subscriptions/check"],
        ["DELETE", "/api/push/subscriptions"],
        ["GET", "/api/push/preferences"],
        ["PATCH", "/api/push/preferences"],
      ] as const) {
        const res = await send(anonymous, method, path, {});
        expect({ method, path, status: res.status }).toEqual({ method, path, status: 401 });
      }
    });
  });

  test("serves the VAPID public key the browser subscribes with", async () => {
    await withRoutes(async (ctx) => {
      const res = await send(ctx, "GET", "/api/push/vapid-public-key");
      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      expect(body).toEqual({ publicKey: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/) });
    });
  });

  test("subscribing and unsubscribing a device", async () => {
    await withRoutes(async (ctx) => {
      const device = await createTestDevice();
      const created = await send(
        ctx,
        "POST",
        "/api/push/subscriptions",
        device.subscription(ENDPOINT),
      );
      expect(created.status).toBe(201);
      const check = await send(ctx, "POST", "/api/push/subscriptions/check", {
        endpoint: ENDPOINT,
      });
      expect(await check.json()).toEqual({ registered: true });
      const gone = await send(ctx, "DELETE", "/api/push/subscriptions", { endpoint: ENDPOINT });
      expect(gone.status).toBe(200);
      const again = await send(ctx, "DELETE", "/api/push/subscriptions", { endpoint: ENDPOINT });
      expect(again.status).toBe(404);
      const after = await send(ctx, "POST", "/api/push/subscriptions/check", {
        endpoint: ENDPOINT,
      });
      expect(await after.json()).toEqual({ registered: false });
      const malformed = await send(ctx, "POST", "/api/push/subscriptions/check", {});
      expect(malformed.status).toBe(400);
    });
  });

  test("a malformed subscription is a 400 and a foreign endpoint a 422", async () => {
    await withRoutes(async (ctx) => {
      const device = await createTestDevice();
      const bad = await send(ctx, "POST", "/api/push/subscriptions", { endpoint: ENDPOINT });
      expect(bad.status).toBe(400);
      const foreign = await send(
        ctx,
        "POST",
        "/api/push/subscriptions",
        device.subscription("https://169.254.169.254/latest/meta-data"),
      );
      expect(foreign.status).toBe(422);
      expect(await foreign.json()).toEqual({ kind: "endpoint_not_allowed" });
    });
  });

  test("preferences can be read and changed, unknown topics are rejected", async () => {
    await withRoutes(async (ctx) => {
      expect(await (await send(ctx, "GET", "/api/push/preferences")).json()).toEqual({
        grocery_added: true,
        todo_due: true,
      });
      const changed = await send(ctx, "PATCH", "/api/push/preferences", { grocery_added: false });
      expect(await changed.json()).toEqual({ grocery_added: false, todo_due: true });
      const unknown = await send(ctx, "PATCH", "/api/push/preferences", { lottery: true });
      expect(unknown.status).toBe(400);
    });
  });
});
