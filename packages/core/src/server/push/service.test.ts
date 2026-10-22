import { describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  type PushMessage,
  parseSessionId,
  parseUserId,
  type SessionId,
  type UserId,
} from "../../shared/index.ts";
import { sessions, users } from "../auth/schema.ts";
import type { Db } from "../db/index.ts";
import { createTestDevice, verifyVapid, withTestAuth } from "../test/index.ts";
import { pushSubscriptions } from "./schema.ts";
import {
  createPushService,
  MAX_DEVICES_PER_PERSON,
  type PushRequest,
  type PushSender,
} from "./service.ts";

const ANNA = parseUserId("u_anna");
const BASILE = parseUserId("u_basile");
const EVE = parseUserId("u_eve");
const MEMBERS = new Set(["anna@example.com", "basile@example.com"]);
const SUBJECT = "https://hejmly.example";

const sessionOf = (user: UserId): SessionId => parseSessionId(`s_${user}`);
const DAY_MS = 24 * 60 * 60 * 1000;

const seed = async (db: Db): Promise<void> => {
  const now = new Date();
  const later = new Date(now.getTime() + DAY_MS);
  await db.insert(users).values([
    { id: ANNA, name: "Anna", email: "anna@example.com", createdAt: now, updatedAt: now },
    { id: BASILE, name: "Basile", email: "basile@example.com", createdAt: now, updatedAt: now },
    { id: EVE, name: "Eve", email: "eve@example.com", createdAt: now, updatedAt: now },
  ]);
  await db.insert(sessions).values(
    [ANNA, BASILE, EVE].map((user) => ({
      id: sessionOf(user),
      token: `token-${user}`,
      userId: user,
      expiresAt: later,
      createdAt: now,
      updatedAt: now,
    })),
  );
};

const deviceRows = (db: Db) =>
  db
    .select({ userId: pushSubscriptions.userId, endpoint: pushSubscriptions.endpoint })
    .from(pushSubscriptions)
    .all();

const recorder = (status: (req: PushRequest) => number = () => 201) => {
  const requests: PushRequest[] = [];
  const send: PushSender = async (req) => {
    requests.push(req);
    return { status: status(req) };
  };
  return { requests, send };
};

const endpoint = (who: string, n = 1) => `https://fcm.googleapis.com/fcm/send/${who}-${n}`;

const message: PushMessage = {
  title: "Grocery list",
  body: "Anna added Milk",
  tag: "grocery-added",
  url: "/grocery",
};

const withPush = async (
  fn: (ctx: {
    db: Db;
    sent: PushRequest[];
    service: ReturnType<typeof createPushService>;
    statusFor: (fn: (req: PushRequest) => number) => void;
  }) => Promise<void>,
): Promise<void> => {
  await withTestAuth({}, async ({ db }) => {
    await seed(db);
    let statusOf: (req: PushRequest) => number = () => 201;
    const { requests, send } = recorder((req) => statusOf(req));
    const service = createPushService(db, {
      isMember: (email) => email !== null && MEMBERS.has(email),
      subject: SUBJECT,
      send,
    });
    await fn({
      db,
      sent: requests,
      service,
      statusFor: (next) => {
        statusOf = next;
      },
    });
  });
};

const subscribe = async (
  service: ReturnType<typeof createPushService>,
  user: UserId,
  url: string,
) => {
  const device = await createTestDevice();
  const result = await service.subscribe(
    { userId: user, sessionId: sessionOf(user) },
    device.subscription(url),
  );
  expect(result.kind).toBe("ok");
  return device;
};

const as = (user: UserId) => ({ userId: user, sessionId: sessionOf(user) });

describe("push service", () => {
  test("generates one VAPID key pair on first use and keeps it", async () => {
    await withTestAuth({}, async ({ db }) => {
      const options = { isMember: () => true, subject: SUBJECT, send: recorder().send };
      const first = await createPushService(db, options).publicKey();
      const second = await createPushService(db, options).publicKey();
      expect(second).toBe(first);
      expect(first).toMatch(/^[A-Za-z0-9_-]{87}$/);
      expect(atob(first.replaceAll("-", "+").replaceAll("_", "/")).charCodeAt(0)).toBe(4);
    });
  });

  test("concurrent first use still yields a single key pair", async () => {
    await withTestAuth({}, async ({ db }) => {
      const service = createPushService(db, {
        isMember: () => true,
        subject: SUBJECT,
        send: recorder().send,
      });
      const keys = await Promise.all([service.publicKey(), service.publicKey()]);
      expect(new Set(keys).size).toBe(1);
    });
  });

  test("refuses endpoints that are not a browser push service", async () => {
    await withPush(async ({ service }) => {
      const device = await createTestDevice();
      for (const url of ["https://169.254.169.254/latest", "https://intranet.local/push"]) {
        expect(await service.subscribe(as(ANNA), device.subscription(url))).toEqual({
          kind: "err",
          error: { kind: "endpoint_not_allowed" },
        });
      }
    });
  });

  test("caps the number of devices per person", async () => {
    await withPush(async ({ service }) => {
      for (let i = 0; i < 10; i += 1) await subscribe(service, ANNA, endpoint("anna", i));
      const device = await createTestDevice();
      expect(await service.subscribe(as(ANNA), device.subscription(endpoint("anna", 99)))).toEqual({
        kind: "err",
        error: { kind: "too_many_devices" },
      });
      expect(
        (await service.subscribe(as(ANNA), device.subscription(endpoint("anna", 3)))).kind,
      ).toBe("ok");
    });
  });

  test("delivers an encrypted, VAPID-signed message to every other member's devices", async () => {
    await withPush(async ({ service, sent }) => {
      const annaPhone = await subscribe(service, ANNA, endpoint("anna"));
      await subscribe(service, BASILE, endpoint("basile"));
      const result = await service.notify("grocery_added", { except: BASILE }, message);
      expect(result).toEqual({ kind: "ok", value: { sent: 1, removed: 0, failed: 0 } });
      expect(sent.map((r) => r.endpoint)).toEqual([endpoint("anna")]);
      const request = sent[0];
      if (request === undefined) throw new Error("nothing sent");
      const headers = new Headers(request.headers);
      expect(headers.get("content-encoding")).toBe("aes128gcm");
      expect(Number(headers.get("ttl"))).toBeGreaterThan(0);
      const plain: unknown = JSON.parse(await annaPhone.decrypt(request.body));
      expect(plain).toEqual(message);
      const claims = await verifyVapid(headers.get("authorization") ?? "");
      expect(claims.aud).toBe("https://fcm.googleapis.com");
      expect(claims.sub).toBe(SUBJECT);
      expect(claims.exp - Date.now() / 1000).toBeLessThanOrEqual(24 * 60 * 60);
      expect(claims.exp - Date.now() / 1000).toBeGreaterThan(0);
      expect(headers.get("authorization")).toContain(`k=${await service.publicKey()}`);
    });
  });

  test("skips people who turned the topic off and people who are no longer members", async () => {
    await withPush(async ({ service, sent }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      await subscribe(service, EVE, endpoint("eve"));
      await service.updatePreferences(ANNA, { grocery_added: false });
      const result = await service.notify("grocery_added", { except: BASILE }, message);
      expect(result).toEqual({ kind: "ok", value: { sent: 0, removed: 0, failed: 0 } });
      expect(sent).toEqual([]);
    });
  });

  test("forgets devices the push service says are gone, and survives failures", async () => {
    await withPush(async ({ service, statusFor }) => {
      await subscribe(service, ANNA, endpoint("anna", 1));
      await subscribe(service, ANNA, endpoint("anna", 2));
      await subscribe(service, ANNA, endpoint("anna", 3));
      statusFor((req) =>
        req.endpoint === endpoint("anna", 1)
          ? 410
          : req.endpoint === endpoint("anna", 2)
            ? 500
            : 201,
      );
      expect(await service.notify("grocery_added", {}, message)).toEqual({
        kind: "ok",
        value: { sent: 1, removed: 1, failed: 1 },
      });
      statusFor(() => 201);
      expect(await service.notify("grocery_added", {}, message)).toEqual({
        kind: "ok",
        value: { sent: 2, removed: 0, failed: 0 },
      });
    });
  });

  test("a sender that throws counts as a failure instead of breaking the caller", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seed(db);
      const service = createPushService(db, {
        isMember: () => true,
        subject: SUBJECT,
        send: async () => {
          throw new Error("network down");
        },
      });
      await subscribe(service, ANNA, endpoint("anna"));
      expect(await service.notify("grocery_added", {}, message)).toEqual({
        kind: "ok",
        value: { sent: 0, removed: 0, failed: 1 },
      });
    });
  });

  test("a device moves to whoever subscribed it last; unsubscribing only removes your own", async () => {
    await withPush(async ({ service, sent }) => {
      await subscribe(service, ANNA, endpoint("shared"));
      await subscribe(service, BASILE, endpoint("shared"));
      expect(await service.unsubscribe(ANNA, endpoint("shared"))).toEqual({
        kind: "err",
        error: { kind: "not_found" },
      });
      await service.notify("grocery_added", { except: ANNA }, message);
      expect(sent.map((r) => r.endpoint)).toEqual([endpoint("shared")]);
      expect((await service.unsubscribe(BASILE, endpoint("shared"))).kind).toBe("ok");
      await service.notify("grocery_added", {}, message);
      expect(sent).toHaveLength(1);
    });
  });

  test("preferences default to on and are stored per person and topic", async () => {
    await withPush(async ({ service }) => {
      expect(await service.preferences(ANNA)).toEqual({ grocery_added: true, todo_due: true });
      expect(await service.updatePreferences(ANNA, { grocery_added: false })).toEqual({
        kind: "ok",
        value: { grocery_added: false, todo_due: true },
      });
      expect(await service.preferences(ANNA)).toEqual({ grocery_added: false, todo_due: true });
      expect(await service.preferences(BASILE)).toEqual({ grocery_added: true, todo_due: true });
    });
  });

  test("a message can be addressed to one person only", async () => {
    await withPush(async ({ service, sent }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      await subscribe(service, BASILE, endpoint("basile"));
      expect(await service.notify("todo_due", { only: BASILE }, message)).toEqual({
        kind: "ok",
        value: { sent: 1, removed: 0, failed: 0 },
      });
      expect(sent.map((r) => r.endpoint)).toEqual([endpoint("basile")]);
      await service.updatePreferences(BASILE, { todo_due: false });
      expect(await service.notify("todo_due", { only: BASILE }, message)).toEqual({
        kind: "ok",
        value: { sent: 0, removed: 0, failed: 0 },
      });
    });
  });

  test("removing a person removes their devices and preferences", async () => {
    await withPush(async ({ db, service }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      await service.updatePreferences(ANNA, { grocery_added: false });
      await db.delete(users).where(eq(users.id, ANNA));
      const count = (table: string): unknown =>
        db.$client.query(`SELECT count(*) AS n FROM ${table} WHERE user_id = 'u_anna'`).get();
      expect(count("push_subscriptions")).toEqual({ n: 0 });
      expect(count("push_preferences")).toEqual({ n: 0 });
    });
  });

  test("a device belongs to the session that turned it on; signing out removes it", async () => {
    await withPush(async ({ db, service, sent }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      await db.delete(sessions).where(eq(sessions.id, sessionOf(ANNA)));
      expect(deviceRows(db)).toEqual([]);
      await service.notify("grocery_added", {}, message);
      expect(sent).toEqual([]);
    });
  });

  test("an expired session's devices are not sent to, and cannot be added", async () => {
    await withPush(async ({ db, service, sent }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      await db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, sessionOf(ANNA)));
      expect(await service.notify("grocery_added", {}, message)).toEqual({
        kind: "ok",
        value: { sent: 0, removed: 0, failed: 0 },
      });
      expect(sent).toEqual([]);
      const device = await createTestDevice();
      expect(await service.subscribe(as(ANNA), device.subscription(endpoint("anna", 2)))).toEqual({
        kind: "err",
        error: { kind: "session_expired" },
      });
      expect(
        await service.subscribe(
          { userId: BASILE, sessionId: sessionOf(ANNA) },
          device.subscription(endpoint("anna", 3)),
        ),
      ).toEqual({ kind: "err", error: { kind: "session_expired" } });
    });
  });

  test("taking over another person's device counts against your own device limit", async () => {
    await withPush(async ({ db, service }) => {
      await subscribe(service, ANNA, endpoint("shared"));
      for (let i = 0; i < MAX_DEVICES_PER_PERSON; i += 1) {
        await subscribe(service, BASILE, endpoint("basile", i));
      }
      const device = await createTestDevice();
      expect(await service.subscribe(as(BASILE), device.subscription(endpoint("shared")))).toEqual({
        kind: "err",
        error: { kind: "too_many_devices" },
      });
      expect(deviceRows(db).filter((r) => r.endpoint === endpoint("shared"))).toEqual([
        { userId: ANNA, endpoint: endpoint("shared") },
      ]);
    });
  });

  test("the same endpoint spelled differently is one device", async () => {
    await withPush(async ({ db, service }) => {
      await subscribe(service, ANNA, "https://FCM.GOOGLEAPIS.COM/fcm/send/anna-1");
      await subscribe(service, ANNA, endpoint("anna"));
      expect(deviceRows(db)).toEqual([{ userId: ANNA, endpoint: endpoint("anna") }]);
      expect(
        await service.unsubscribe(ANNA, "https://fcm.googleapis.com:443/fcm/send/anna-1"),
      ).toEqual({ kind: "ok", value: { endpoint: endpoint("anna") } });
    });
  });

  test("tells a person whether this device is registered to them", async () => {
    await withPush(async ({ service }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      expect(await service.registered(ANNA, endpoint("anna"))).toEqual({
        kind: "ok",
        value: { registered: true },
      });
      expect(await service.registered(BASILE, endpoint("anna"))).toEqual({
        kind: "ok",
        value: { registered: false },
      });
      expect(await service.registered(ANNA, "https://intranet.local/x")).toEqual({
        kind: "ok",
        value: { registered: false },
      });
    });
  });

  test("a device the push service keeps refusing is dropped; throttling and outages are not", async () => {
    await withPush(async ({ db, service, statusFor }) => {
      await subscribe(service, ANNA, endpoint("anna", 1));
      await subscribe(service, ANNA, endpoint("anna", 2));
      await subscribe(service, ANNA, endpoint("anna", 3));
      statusFor((req) =>
        req.endpoint === endpoint("anna", 1)
          ? 403
          : req.endpoint === endpoint("anna", 2)
            ? 429
            : 503,
      );
      for (let i = 0; i < 2; i += 1) {
        expect(await service.notify("grocery_added", {}, message)).toEqual({
          kind: "ok",
          value: { sent: 0, removed: 0, failed: 3 },
        });
      }
      expect(await service.notify("grocery_added", {}, message)).toEqual({
        kind: "ok",
        value: { sent: 0, removed: 1, failed: 2 },
      });
      expect(deviceRows(db).map((r) => r.endpoint)).toEqual([
        endpoint("anna", 2),
        endpoint("anna", 3),
      ]);
    });
  });

  test("a delivered message clears earlier refusals", async () => {
    await withPush(async ({ db, service, statusFor }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      statusFor(() => 403);
      await service.notify("grocery_added", {}, message);
      await service.notify("grocery_added", {}, message);
      statusFor(() => 201);
      await service.notify("grocery_added", {}, message);
      statusFor(() => 403);
      await service.notify("grocery_added", {}, message);
      await service.notify("grocery_added", {}, message);
      expect(deviceRows(db)).toHaveLength(1);
    });
  });

  test("never sends to a stored endpoint that is no longer an allowed push service", async () => {
    await withPush(async ({ db, service, sent }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      db.$client.run("UPDATE push_subscriptions SET endpoint = 'https://169.254.169.254/x'");
      expect(await service.notify("grocery_added", {}, message)).toEqual({
        kind: "ok",
        value: { sent: 0, removed: 1, failed: 0 },
      });
      expect(sent).toEqual([]);
      expect(deviceRows(db)).toEqual([]);
    });
  });

  test("refuses a message that would not pass the service worker's checks", async () => {
    await withPush(async ({ service, sent }) => {
      await subscribe(service, ANNA, endpoint("anna"));
      const result = await service.notify(
        "grocery_added",
        {},
        { ...message, url: "https://evil.example/" },
      );
      expect(result).toEqual({ kind: "err", error: { kind: "invalid_message" } });
      expect(sent).toEqual([]);
    });
  });

  test("a storage failure is reported without logging the device's endpoint or keys", async () => {
    await withPush(async ({ db, service }) => {
      const logged = spyOn(console, "error").mockImplementation(() => {});
      try {
        db.$client.run("DROP TABLE push_subscriptions");
        const device = await createTestDevice();
        const input = device.subscription(endpoint("secret-device"));
        expect(await service.subscribe(as(ANNA), input)).toEqual({
          kind: "err",
          error: { kind: "unavailable" },
        });
        expect(await service.unsubscribe(ANNA, endpoint("secret-device"))).toEqual({
          kind: "err",
          error: { kind: "unavailable" },
        });
        const output = JSON.stringify(logged.mock.calls);
        expect(output).toContain("push:");
        expect(output).not.toContain("secret-device");
        expect(output).not.toContain(input.keys.p256dh);
      } finally {
        logged.mockRestore();
      }
    });
  });

  test("a storage failure while notifying is an error result, not a throw", async () => {
    await withPush(async ({ db, service }) => {
      const logged = spyOn(console, "error").mockImplementation(() => {});
      try {
        db.$client.run("DROP TABLE push_subscriptions");
        expect(await service.notify("grocery_added", {}, message)).toEqual({
          kind: "err",
          error: { kind: "unavailable" },
        });
      } finally {
        logged.mockRestore();
      }
    });
  });

  test("an existing key pair is loaded, not regenerated", async () => {
    await withTestAuth({}, async ({ db }) => {
      const options = { isMember: () => true, subject: SUBJECT, send: recorder().send };
      await createPushService(db, options).publicKey();
      const generate = spyOn(crypto.subtle, "generateKey");
      try {
        await createPushService(db, options).publicKey();
        expect(generate).not.toHaveBeenCalled();
      } finally {
        generate.mockRestore();
      }
    });
  });
});
