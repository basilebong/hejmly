import { describe, expect, test } from "bun:test";
import {
  type Auth,
  createRequireSession,
  type Db,
  type SessionVariables,
} from "@hejmly/core/server";
import { googleProvisioningSource, withTestAuth } from "@hejmly/core/server/test";
import { Hono } from "hono";
import * as v from "valibot";
import { type GroceryItemId, parseGroceryItemId } from "../shared/index.ts";
import type { CleanupScheduler } from "./cleanup-scheduler.ts";
import { createGroceryRoutes } from "./routes.ts";
import { createGroceryService } from "./service.ts";

const TEST_EMAIL = "basile@example.com";

type CleanupCalls = {
  scheduled: GroceryItemId[];
  cancelled: GroceryItemId[];
};

const createStubCleanup = (): { scheduler: CleanupScheduler; calls: CleanupCalls } => {
  const calls: CleanupCalls = { scheduled: [], cancelled: [] };
  const scheduler: CleanupScheduler = {
    async schedule(id) {
      calls.scheduled.push(id);
    },
    async cancel(id) {
      calls.cancelled.push(id);
    },
    async close() {},
  };
  return { scheduler, calls };
};

type TestApp = Hono<{ Variables: SessionVariables }>;

type GroceryTestContext = {
  app: TestApp;
  cookie: string;
  userId: string;
  db: Db;
  auth: Auth;
  cleanup: CleanupCalls;
};

const seedSessionCookie = async (
  auth: Auth,
  signSessionCookie: (token: string) => Promise<string>,
): Promise<{ userId: string; cookie: string }> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    {
      name: "Basile",
      email: TEST_EMAIL,
    },
    googleProvisioningSource,
  );
  const session = await ctx.internalAdapter.createSession(user.id);
  const signed = await signSessionCookie(session.token);
  return { userId: user.id, cookie: `Hejmly.session_token=${signed}` };
};

const withGrocery = async (fn: (ctx: GroceryTestContext) => Promise<void>): Promise<void> => {
  await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db, signSessionCookie }) => {
    const { userId, cookie } = await seedSessionCookie(auth, signSessionCookie);
    const service = createGroceryService(db);
    const { scheduler, calls } = createStubCleanup();
    const app: TestApp = new Hono<{ Variables: SessionVariables }>()
      .use("/api/*", createRequireSession(auth))
      .route("/api/grocery", createGroceryRoutes({ service, cleanup: scheduler }));
    await fn({ app, cookie, userId, db, auth, cleanup: calls });
  });
};

const ItemResponseSchema = v.object({
  id: v.string(),
  name: v.string(),
  description: v.nullable(v.string()),
  status: v.union([
    v.object({ kind: v.literal("pending") }),
    v.object({
      kind: v.literal("purchased"),
      purchasedAt: v.number(),
      purchasedBy: v.string(),
    }),
  ]),
  createdAt: v.number(),
  updatedAt: v.number(),
  addedBy: v.object({
    id: v.string(),
    name: v.string(),
    initial: v.string(),
  }),
});
type ItemResponse = v.InferOutput<typeof ItemResponseSchema>;

const ItemEnvelopeSchema = v.object({ item: ItemResponseSchema });
const ItemListSchema = v.object({ items: v.array(ItemResponseSchema) });
const ErrorBodySchema = v.object({
  kind: v.string(),
  state: v.optional(v.string()),
  message: v.optional(v.string()),
});

const parseBody = async <S extends v.GenericSchema>(
  res: Response,
  schema: S,
): Promise<v.InferOutput<S>> => {
  const raw: unknown = await res.json();
  return v.parse(schema, raw);
};

const createItem = async (
  app: TestApp,
  cookie: string,
  body: { name: string; description?: string },
): Promise<ItemResponse> => {
  const res = await app.request("/api/grocery/items", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  const payload = await parseBody(res, ItemEnvelopeSchema);
  return payload.item;
};

describe("grocery routes", () => {
  describe("auth", () => {
    test("every route is 401 without a session", async () => {
      await withGrocery(async ({ app }) => {
        const probes: Array<{ method: string; path: string; body?: unknown }> = [
          { method: "GET", path: "/api/grocery/items" },
          { method: "POST", path: "/api/grocery/items", body: { name: "Milk" } },
          {
            method: "PATCH",
            path: "/api/grocery/items/some-id",
            body: { purchased: true },
          },
          {
            method: "PATCH",
            path: "/api/grocery/items/some-id/content",
            body: { name: "Milk" },
          },
          { method: "DELETE", path: "/api/grocery/items/some-id" },
        ];
        for (const probe of probes) {
          const init: RequestInit = {
            method: probe.method,
            headers: { "content-type": "application/json" },
          };
          if (probe.body !== undefined) init.body = JSON.stringify(probe.body);
          const res = await app.request(probe.path, init);
          expect(res.status).toBe(401);
        }
      });
    });
  });

  describe("GET /items", () => {
    test("returns an empty list when no items exist", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const res = await app.request("/api/grocery/items", { headers: { cookie } });
        expect(res.status).toBe(200);
        expect(await parseBody(res, ItemListSchema)).toEqual({ items: [] });
      });
    });

    test("returns items in newest-first order", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const first = await createItem(app, cookie, { name: "Milk" });
        // ensure distinct createdAt
        await new Promise((r) => setTimeout(r, 5));
        const second = await createItem(app, cookie, { name: "Bread" });

        const res = await app.request("/api/grocery/items", { headers: { cookie } });
        const payload = await parseBody(res, ItemListSchema);
        expect(payload.items.map((i) => i.id)).toEqual([second.id, first.id]);
      });
    });
  });

  describe("POST /items", () => {
    test("creates a pending item with name only", async () => {
      await withGrocery(async ({ app, cookie, userId }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        expect(item.name).toBe("Milk");
        expect(item.description).toBeNull();
        expect(item.status).toEqual({ kind: "pending" });
        expect(item.addedBy.id).toBe(userId);
      });
    });

    test("creates a pending item with name and description", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, {
          name: "Sparkling water",
          description: "the small bottles, six pack",
        });
        expect(item.name).toBe("Sparkling water");
        expect(item.description).toBe("the small bottles, six pack");
      });
    });

    test("rejects an empty name with 400", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const res = await app.request("/api/grocery/items", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "" }),
        });
        expect(res.status).toBe(400);
        const body = await parseBody(res, ErrorBodySchema);
        expect(body.kind).toBe("invalid_input");
      });
    });

    test("rejects an over-long name with 400", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const res = await app.request("/api/grocery/items", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "x".repeat(121) }),
        });
        expect(res.status).toBe(400);
      });
    });
  });

  describe("PATCH /items/:id (toggle)", () => {
    test("marks an item purchased and schedules cleanup", async () => {
      await withGrocery(async ({ app, cookie, userId, cleanup }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        const res = await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: true }),
        });
        expect(res.status).toBe(200);
        const body = await parseBody(res, ItemEnvelopeSchema);
        expect(body.item.status).toMatchObject({ kind: "purchased", purchasedBy: userId });
        expect(cleanup.scheduled).toEqual([parseGroceryItemId(item.id)]);
        expect(cleanup.cancelled).toEqual([]);
      });
    });

    test("unmarks a purchased item and cancels cleanup", async () => {
      await withGrocery(async ({ app, cookie, cleanup }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: true }),
        });
        const res = await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: false }),
        });
        expect(res.status).toBe(200);
        const body = await parseBody(res, ItemEnvelopeSchema);
        expect(body.item.status).toEqual({ kind: "pending" });
        expect(cleanup.cancelled).toEqual([parseGroceryItemId(item.id)]);
      });
    });

    test("rejects marking an already-purchased item with 409", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: true }),
        });
        const res = await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: true }),
        });
        expect(res.status).toBe(409);
        const body = await parseBody(res, ErrorBodySchema);
        expect(body).toEqual({ kind: "already_in_state", state: "purchased" });
      });
    });

    test("returns 400 for invalid body", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        const res = await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: "yes" }),
        });
        expect(res.status).toBe(400);
      });
    });

    test("returns 404 for an unknown item", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const res = await app.request("/api/grocery/items/does-not-exist", {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: true }),
        });
        expect(res.status).toBe(404);
      });
    });
  });

  describe("PATCH /items/:id/content (edit)", () => {
    test("updates the name", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        const res = await app.request(`/api/grocery/items/${item.id}/content`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "Almond milk" }),
        });
        expect(res.status).toBe(200);
        const body = await parseBody(res, ItemEnvelopeSchema);
        expect(body.item.name).toBe("Almond milk");
        expect(body.item.description).toBeNull();
      });
    });

    test("updates the description", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        const res = await app.request(`/api/grocery/items/${item.id}/content`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ description: "two cartons" }),
        });
        expect(res.status).toBe(200);
        const body = await parseBody(res, ItemEnvelopeSchema);
        expect(body.item.name).toBe("Milk");
        expect(body.item.description).toBe("two cartons");
      });
    });

    test("updates name and description together", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, {
          name: "Milk",
          description: "two cartons",
        });
        const res = await app.request(`/api/grocery/items/${item.id}/content`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "Almond milk", description: "one carton" }),
        });
        expect(res.status).toBe(200);
        const body = await parseBody(res, ItemEnvelopeSchema);
        expect(body.item.name).toBe("Almond milk");
        expect(body.item.description).toBe("one carton");
      });
    });

    test("clears the description when null is sent", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, {
          name: "Milk",
          description: "two cartons",
        });
        const res = await app.request(`/api/grocery/items/${item.id}/content`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ description: null }),
        });
        expect(res.status).toBe(200);
        const body = await parseBody(res, ItemEnvelopeSchema);
        expect(body.item.description).toBeNull();
      });
    });

    test("rejects an empty body with 400", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        const res = await app.request(`/api/grocery/items/${item.id}/content`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      });
    });

    test("rejects an over-long name with 400", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        const res = await app.request(`/api/grocery/items/${item.id}/content`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "x".repeat(121) }),
        });
        expect(res.status).toBe(400);
      });
    });

    test("returns 404 for an unknown item", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const res = await app.request("/api/grocery/items/does-not-exist/content", {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "Milk" }),
        });
        expect(res.status).toBe(404);
      });
    });

    test("does not change status when editing content", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: true }),
        });
        const res = await app.request(`/api/grocery/items/${item.id}/content`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "Almond milk" }),
        });
        expect(res.status).toBe(200);
        const body = await parseBody(res, ItemEnvelopeSchema);
        expect(body.item.status).toMatchObject({ kind: "purchased" });
        expect(body.item.name).toBe("Almond milk");
      });
    });
  });

  describe("DELETE /items/:id", () => {
    test("removes an item and cancels cleanup", async () => {
      await withGrocery(async ({ app, cookie, cleanup }) => {
        const item = await createItem(app, cookie, { name: "Milk" });
        const res = await app.request(`/api/grocery/items/${item.id}`, {
          method: "DELETE",
          headers: { cookie },
        });
        expect(res.status).toBe(200);
        const list = await app.request("/api/grocery/items", { headers: { cookie } });
        expect(await parseBody(list, ItemListSchema)).toEqual({ items: [] });
        expect(cleanup.cancelled).toEqual([parseGroceryItemId(item.id)]);
      });
    });

    test("returns 404 for an unknown item", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const res = await app.request("/api/grocery/items/does-not-exist", {
          method: "DELETE",
          headers: { cookie },
        });
        expect(res.status).toBe(404);
      });
    });
  });

  describe("full lifecycle", () => {
    test("add → edit → mark purchased → unmark → remove", async () => {
      await withGrocery(async ({ app, cookie }) => {
        const item = await createItem(app, cookie, { name: "Milk" });

        let res = await app.request(`/api/grocery/items/${item.id}/content`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ name: "Almond milk", description: "one carton" }),
        });
        expect(res.status).toBe(200);

        res = await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: true }),
        });
        expect(res.status).toBe(200);

        res = await app.request(`/api/grocery/items/${item.id}`, {
          method: "PATCH",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ purchased: false }),
        });
        expect(res.status).toBe(200);

        res = await app.request(`/api/grocery/items/${item.id}`, {
          method: "DELETE",
          headers: { cookie },
        });
        expect(res.status).toBe(200);

        const list = await app.request("/api/grocery/items", { headers: { cookie } });
        expect(await parseBody(list, ItemListSchema)).toEqual({ items: [] });
      });
    });
  });
});
