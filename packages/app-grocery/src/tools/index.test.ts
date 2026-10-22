import { describe, expect, test } from "bun:test";
import type { AuditRecorder, Auth, Db } from "@hejmly/core/server";
import { createAuditRecorder } from "@hejmly/core/server";
import { googleProvisioningSource, withTestAuth } from "@hejmly/core/server/test";
import { parseUserId, type UserId } from "@hejmly/core/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as v from "valibot";
import type { CleanupScheduler, GroceryAnnouncer } from "../server/index.ts";
import { createGroceryService } from "../server/index.ts";
import { type GroceryItemId, parseGroceryItemId } from "../shared/index.ts";
import { registerGroceryTools } from "./index.ts";

const TEST_EMAIL = "basile@example.com";

type CleanupCalls = { scheduled: GroceryItemId[]; cancelled: GroceryItemId[] };

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

const noopCleanup = createStubCleanup().scheduler;

const recordingAnnouncer = (): { announcer: GroceryAnnouncer; announced: string[] } => {
  const announced: string[] = [];
  return {
    announced,
    announcer: {
      async itemAdded(item) {
        announced.push(item.name);
      },
      async close() {},
    },
  };
};

const seedUser = async (auth: Auth): Promise<UserId> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name: "Basile", email: TEST_EMAIL },
    googleProvisioningSource,
  );
  return parseUserId(user.id);
};

const connect = async (
  db: Db,
  actor: UserId,
  cleanup: CleanupScheduler = noopCleanup,
  announcer: GroceryAnnouncer = recordingAnnouncer().announcer,
): Promise<Client> => {
  const server = new McpServer({ name: "Hejmly-test", version: "1.0.0" });
  registerGroceryTools(server, {
    service: createGroceryService(db),
    actor,
    audit: createAuditRecorder(db),
    cleanup,
    announcer,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

const AuditRowSchema = v.object({ action: v.string(), metadata_json: v.nullable(v.string()) });

const auditEntries = (db: Db): { action: string; metadata: unknown }[] =>
  db.$client
    .query("SELECT action, metadata_json FROM audit_log ORDER BY created_at")
    .all()
    .map((raw) => {
      const row = v.parse(AuditRowSchema, raw);
      const metadata: unknown = row.metadata_json === null ? null : JSON.parse(row.metadata_json);
      return { action: row.action, metadata };
    });

const auditActions = (db: Db): string[] =>
  db.$client
    .query("SELECT action FROM audit_log ORDER BY created_at")
    .all()
    .flatMap((row) =>
      typeof row === "object" && row !== null && "action" in row ? [row.action] : [],
    )
    .filter((action): action is string => typeof action === "string");

const itemIdOf = (result: unknown): string => {
  if (result !== null && typeof result === "object" && "structuredContent" in result) {
    const sc = result.structuredContent;
    if (sc !== null && typeof sc === "object" && "item" in sc) {
      const item = sc.item;
      if (
        item !== null &&
        typeof item === "object" &&
        "id" in item &&
        typeof item.id === "string"
      ) {
        return item.id;
      }
    }
  }
  throw new Error("expected item.id in tool result");
};

describe("grocery MCP tools", () => {
  test("an over-long item id is refused before the handler runs, so nothing is audited", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const result = await client.callTool({
        name: "grocery__remove_item",
        arguments: { itemId: "x".repeat(65) },
      });
      expect(result.isError).toBe(true);
      expect(auditEntries(db)).toEqual([]);
    });
  });

  test("lists the registered tools", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "grocery__add_item",
        "grocery__list_items",
        "grocery__mark_pending",
        "grocery__mark_purchased",
        "grocery__remove_item",
        "grocery__update_item",
      ]);
    });
  });

  test("add_item creates a pending item attributed to the actor", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const actor = await seedUser(auth);
      const client = await connect(db, actor);
      const result = await client.callTool({
        name: "grocery__add_item",
        arguments: { name: "Milk", description: "Whole" },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        item: {
          name: "Milk",
          description: "Whole",
          status: { kind: "pending" },
          addedBy: { kind: "user", id: actor },
        },
      });
      expect(auditActions(db)).toContain("grocery__add_item");
    });
  });

  test("mark_purchased then list with the purchased filter", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const actor = await seedUser(auth);
      const client = await connect(db, actor);
      const added = await client.callTool({
        name: "grocery__add_item",
        arguments: { name: "Eggs" },
      });
      const itemId = itemIdOf(added);

      const purchased = await client.callTool({
        name: "grocery__mark_purchased",
        arguments: { itemId },
      });
      expect(purchased.structuredContent).toMatchObject({
        item: { status: { kind: "purchased" } },
      });

      const list = await client.callTool({
        name: "grocery__list_items",
        arguments: { status: "purchased" },
      });
      expect(list.structuredContent).toMatchObject({ items: [{ name: "Eggs" }] });
    });
  });

  test("update_item changes the name", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const actor = await seedUser(auth);
      const client = await connect(db, actor);
      const added = await client.callTool({
        name: "grocery__add_item",
        arguments: { name: "Bred" },
      });
      const itemId = itemIdOf(added);
      const updated = await client.callTool({
        name: "grocery__update_item",
        arguments: { itemId, name: "Bread" },
      });
      expect(updated.structuredContent).toMatchObject({ item: { name: "Bread" } });
    });
  });

  test("remove_item deletes the item", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const actor = await seedUser(auth);
      const client = await connect(db, actor);
      const added = await client.callTool({
        name: "grocery__add_item",
        arguments: { name: "Soap" },
      });
      const itemId = itemIdOf(added);
      await client.callTool({ name: "grocery__remove_item", arguments: { itemId } });
      const list = await client.callTool({ name: "grocery__list_items", arguments: {} });
      expect(list.structuredContent).toMatchObject({ items: [] });
    });
  });

  test("mark_purchased on a missing item returns an MCP error", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const result = await client.callTool({
        name: "grocery__mark_purchased",
        arguments: { itemId: "does-not-exist" },
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        error: { kind: "not_found", id: "does-not-exist" },
      });
      expect(auditEntries(db)).toEqual([
        {
          action: "grocery__mark_purchased",
          metadata: { itemId: "does-not-exist", error: "not_found" },
        },
      ]);
    });
  });

  test("marking an already-purchased item again is a structured, audited error", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const added = await client.callTool({
        name: "grocery__add_item",
        arguments: { name: "Milk" },
      });
      const itemId = itemIdOf(added);
      await client.callTool({ name: "grocery__mark_purchased", arguments: { itemId } });
      const again = await client.callTool({
        name: "grocery__mark_purchased",
        arguments: { itemId },
      });
      expect(again.isError).toBe(true);
      expect(again.structuredContent).toEqual({
        error: { kind: "already_in_state", state: "purchased" },
      });
      expect(auditEntries(db).at(-1)).toEqual({
        action: "grocery__mark_purchased",
        metadata: { itemId, error: "already_in_state" },
      });
    });
  });

  test("a failing audit recorder does not fail the tool call", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const actor = await seedUser(auth);
      const failingAudit: AuditRecorder = {
        record: async () => {
          throw new Error("audit unavailable");
        },
      };
      const server = new McpServer({ name: "Hejmly-test", version: "1.0.0" });
      registerGroceryTools(server, {
        service: createGroceryService(db),
        actor,
        audit: failingAudit,
        cleanup: noopCleanup,
        announcer: recordingAnnouncer().announcer,
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const result = await client.callTool({
        name: "grocery__add_item",
        arguments: { name: "Milk" },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({ item: { name: "Milk" } });
      expect(db.$client.query("SELECT name FROM grocery_items").all()).toEqual([{ name: "Milk" }]);
    });
  });

  test("mark_purchased schedules cleanup; mark_pending and remove cancel it", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const { scheduler, calls } = createStubCleanup();
      const client = await connect(db, await seedUser(auth), scheduler);
      const added = await client.callTool({
        name: "grocery__add_item",
        arguments: { name: "Eggs" },
      });
      const itemId = itemIdOf(added);

      await client.callTool({ name: "grocery__mark_purchased", arguments: { itemId } });
      expect(calls.scheduled).toEqual([parseGroceryItemId(itemId)]);

      await client.callTool({ name: "grocery__mark_pending", arguments: { itemId } });
      await client.callTool({ name: "grocery__remove_item", arguments: { itemId } });
      expect(calls.cancelled).toEqual([parseGroceryItemId(itemId), parseGroceryItemId(itemId)]);
    });
  });

  test("add_item announces the new item to the household", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const { announcer, announced } = recordingAnnouncer();
      const client = await connect(db, await seedUser(auth), noopCleanup, announcer);
      await client.callTool({ name: "grocery__add_item", arguments: { name: "Eggs" } });
      expect(announced).toEqual(["Eggs"]);
    });
  });
});
