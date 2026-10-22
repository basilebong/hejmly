import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPushService, type Db, type PushRequest } from "@hejmly/core/server";
import { sessions, users } from "@hejmly/core/server/schema";
import { createTestDevice, type TestDevice, withTestAuth } from "@hejmly/core/server/test";
import {
  type PushMessage,
  PushMessageSchema,
  parseSessionId,
  parseUserId,
  type UserId,
} from "@hejmly/core/shared";
import { shutdownManager } from "bunqueue/client";
import * as v from "valibot";
import { createGroceryAnnouncer, type GroceryAnnouncer } from "./announcer.ts";
import { createCleanupScheduler } from "./cleanup-scheduler.ts";
import { createGroceryService, type GroceryService } from "./service.ts";

const ANNA = parseUserId("u_anna");
const BASILE = parseUserId("u_basile");
const WINDOW_MS = 300;
const GRACE_MS = 50;

type Ctx = {
  grocery: GroceryService;
  announcer: GroceryAnnouncer;
  sent: PushRequest[];
  annaPhone: TestDevice;
  basilePhone: TestDevice;
};

const endpointOf = (who: string) => `https://fcm.googleapis.com/fcm/send/${who}`;

const seed = async (db: Db): Promise<void> => {
  const now = new Date();
  await db.insert(users).values([
    { id: ANNA, name: "Anna", email: "anna@example.com", createdAt: now, updatedAt: now },
    { id: BASILE, name: "Basile", email: "basile@example.com", createdAt: now, updatedAt: now },
  ]);
  await db.insert(sessions).values(
    [ANNA, BASILE].map((user) => ({
      id: `s_${user}`,
      token: `token-${user}`,
      userId: user,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    })),
  );
};

const as = (user: UserId) => ({ userId: user, sessionId: parseSessionId(`s_${user}`) });

const withAnnouncer = async (fn: (ctx: Ctx) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "hejmly-announce-"));
  try {
    await withTestAuth({}, async ({ db }) => {
      await seed(db);
      const sent: PushRequest[] = [];
      const push = createPushService(db, {
        isMember: () => true,
        subject: "https://hejmly.example",
        send: async (req) => {
          sent.push(req);
          return { status: 201 };
        },
      });
      const annaPhone = await createTestDevice();
      const basilePhone = await createTestDevice();
      await push.subscribe(as(ANNA), annaPhone.subscription(endpointOf("anna")));
      await push.subscribe(as(BASILE), basilePhone.subscription(endpointOf("basile")));
      const grocery = createGroceryService(db);
      const announcer = createGroceryAnnouncer({
        service: grocery,
        push,
        dataPath: join(dir, "announce.db"),
        windowMs: WINDOW_MS,
        graceMs: GRACE_MS,
      });
      try {
        await fn({ grocery, announcer, sent, annaPhone, basilePhone });
      } finally {
        await announcer.close();
        shutdownManager();
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const add = async (ctx: Ctx, name: string, by: typeof ANNA) => {
  const created = await ctx.grocery.create({ name }, by);
  if (created.kind === "err") throw new Error(`could not add ${name}`);
  await ctx.announcer.itemAdded(created.value);
  return created.value;
};

const settle = async (ctx: Ctx, expected: number): Promise<void> => {
  const deadline = Date.now() + WINDOW_MS * 2 + GRACE_MS + 3000;
  while (ctx.sent.length < expected && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((r) => setTimeout(r, WINDOW_MS));
};

const messagesFor = async (ctx: Ctx, who: "anna" | "basile"): Promise<PushMessage[]> => {
  const phone = who === "anna" ? ctx.annaPhone : ctx.basilePhone;
  return Promise.all(
    ctx.sent
      .filter((r) => r.endpoint === endpointOf(who))
      .map(async (r) => v.parse(PushMessageSchema, JSON.parse(await phone.decrypt(r.body)))),
  );
};

const atWindowStart = async (): Promise<void> => {
  const into = Date.now() % WINDOW_MS;
  if (into > WINDOW_MS / 3) await new Promise((r) => setTimeout(r, WINDOW_MS - into + 5));
};

describe("grocery announcer", () => {
  test("one notification per person and window, to everyone else, listing what they added", async () => {
    await withAnnouncer(async (ctx) => {
      await atWindowStart();
      await add(ctx, "Milk", ANNA);
      await add(ctx, "Eggs", ANNA);
      await add(ctx, "Coffee", BASILE);
      await settle(ctx, 2);

      const toBasile = await messagesFor(ctx, "basile");
      const toAnna = await messagesFor(ctx, "anna");
      const tag = expect.stringMatching(/^grocery-[A-Za-z0-9_-]+$/);
      expect(toBasile).toEqual([
        { title: "Grocery list", body: "Anna added Milk and Eggs", tag, url: "/grocery" },
      ]);
      expect(toAnna).toEqual([
        { title: "Grocery list", body: "Basile added Coffee", tag, url: "/grocery" },
      ]);
      expect(toBasile[0]?.tag).not.toBe(toAnna[0]?.tag);
    });
  });

  test("items bought or removed before the window closes are not announced", async () => {
    await withAnnouncer(async (ctx) => {
      await atWindowStart();
      const milk = await add(ctx, "Milk", ANNA);
      const eggs = await add(ctx, "Eggs", ANNA);
      await ctx.grocery.markPurchased(milk.id, BASILE);
      await ctx.grocery.remove(eggs.id);
      await settle(ctx, 1);
      expect(ctx.sent).toEqual([]);
    });
  });

  test("adds racing each other still produce a single notification", async () => {
    await withAnnouncer(async (ctx) => {
      await atWindowStart();
      const items = await Promise.all(
        ["Milk", "Eggs", "Bread", "Jam"].map((name) => ctx.grocery.create({ name }, ANNA)),
      );
      await Promise.all(
        items.map((r) => (r.kind === "ok" ? ctx.announcer.itemAdded(r.value) : Promise.resolve())),
      );
      await settle(ctx, 1);
      const received = await messagesFor(ctx, "basile");
      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        body: expect.stringMatching(
          /^Anna added (Milk|Eggs|Bread|Jam), (Milk|Eggs|Bread|Jam), (Milk|Eggs|Bread|Jam) and 1 more$/,
        ),
      });
    });
  });

  test("a late report of an item already announced does not announce the window again", async () => {
    await withAnnouncer(async (ctx) => {
      await atWindowStart();
      await add(ctx, "Milk", ANNA);
      const eggs = await ctx.grocery.create({ name: "Eggs" }, ANNA);
      if (eggs.kind === "err") throw new Error("could not add Eggs");
      await settle(ctx, 1);
      expect(await messagesFor(ctx, "basile")).toMatchObject([
        { body: "Anna added Milk and Eggs" },
      ]);
      await ctx.announcer.itemAdded(eggs.value);
      await settle(ctx, 2);
      expect(await messagesFor(ctx, "basile")).toHaveLength(1);
    });
  });

  test("shares the embedded job store with the cleanup scheduler", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hejmly-jobs-"));
    try {
      await withTestAuth({}, async ({ db }) => {
        const service = createGroceryService(db);
        const dataPath = join(dir, "jobs.db");
        const cleanup = createCleanupScheduler({ service, dataPath });
        const announcer = createGroceryAnnouncer({
          service,
          push: { notify: async () => ({ kind: "ok", value: { sent: 0, removed: 0, failed: 0 } }) },
          dataPath,
        });
        await announcer.close();
        await cleanup.close();
        shutdownManager();
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
