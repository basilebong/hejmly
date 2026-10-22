import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { type PushMessage, parseUserId, type UserId } from "../../shared/index.ts";
import { users } from "../auth/schema.ts";
import type { Db } from "../db/index.ts";
import { createTestDevice, verifyVapid, withTestAuth } from "../test/index.ts";
import { createPushService, type PushRequest, type PushSender } from "./service.ts";

const ANNA = parseUserId("u_anna");
const BASILE = parseUserId("u_basile");
const EVE = parseUserId("u_eve");
const MEMBERS = new Set(["anna@example.com", "basile@example.com"]);
const SUBJECT = "https://hejmly.example";

const seed = async (db: Db): Promise<void> => {
  const now = new Date();
  await db.insert(users).values([
    { id: ANNA, name: "Anna", email: "anna@example.com", createdAt: now, updatedAt: now },
    { id: BASILE, name: "Basile", email: "basile@example.com", createdAt: now, updatedAt: now },
    { id: EVE, name: "Eve", email: "eve@example.com", createdAt: now, updatedAt: now },
  ]);
};

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
  const result = await service.subscribe(user, device.subscription(url));
  expect(result.kind).toBe("ok");
  return device;
};

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
        expect(await service.subscribe(ANNA, device.subscription(url))).toEqual({
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
      expect(await service.subscribe(ANNA, device.subscription(endpoint("anna", 99)))).toEqual({
        kind: "err",
        error: { kind: "too_many_devices" },
      });
      expect((await service.subscribe(ANNA, device.subscription(endpoint("anna", 3)))).kind).toBe(
        "ok",
      );
    });
  });

  test("delivers an encrypted, VAPID-signed message to every other member's devices", async () => {
    await withPush(async ({ service, sent }) => {
      const annaPhone = await subscribe(service, ANNA, endpoint("anna"));
      await subscribe(service, BASILE, endpoint("basile"));
      const result = await service.notify("grocery_added", { except: BASILE }, message);
      expect(result).toEqual({ sent: 1, removed: 0, failed: 0 });
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
      expect(result).toEqual({ sent: 0, removed: 0, failed: 0 });
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
        sent: 1,
        removed: 1,
        failed: 1,
      });
      statusFor(() => 201);
      expect(await service.notify("grocery_added", {}, message)).toEqual({
        sent: 2,
        removed: 0,
        failed: 0,
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
        sent: 0,
        removed: 0,
        failed: 1,
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

  test("preferences default to on and are stored per person", async () => {
    await withPush(async ({ service }) => {
      expect(await service.preferences(ANNA)).toEqual({ grocery_added: true });
      expect(await service.updatePreferences(ANNA, { grocery_added: false })).toEqual({
        grocery_added: false,
      });
      expect(await service.preferences(ANNA)).toEqual({ grocery_added: false });
      expect(await service.preferences(BASILE)).toEqual({ grocery_added: true });
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
});
