import { describe, expect, test } from "bun:test";
import type { Db } from "../db/index.ts";
import { withTestAuth } from "../test/index.ts";
import { linkExistingClientsToResource } from "./backfill.ts";
import { oauthClientResources, oauthClients, oauthResources } from "./schema.ts";

const MCP_RESOURCE = "http://localhost:5173/mcp";

const seedClient = async (db: Db, clientId: string): Promise<void> => {
  await db.insert(oauthClients).values({
    id: `row-${clientId}`,
    clientId,
    name: "Claude",
    redirectUris: ["https://claude.ai/cb"],
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
  });
};

describe("linkExistingClientsToResource", () => {
  test("registers the resource and links a client that predates the resource registry", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seedClient(db, "client-1");

      const result = await linkExistingClientsToResource(db, MCP_RESOURCE);

      expect(result).toEqual({ resourceCreated: true, clientsLinked: 1 });
      const resources = await db.select().from(oauthResources);
      expect(resources.map((r) => r.identifier)).toEqual([MCP_RESOURCE]);
      const links = await db.select().from(oauthClientResources);
      expect(links.map((l) => [l.clientId, l.resourceId])).toEqual([["client-1", MCP_RESOURCE]]);
    });
  });

  test("links every pre-existing client, not just the first", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seedClient(db, "client-1");
      await seedClient(db, "client-2");
      await seedClient(db, "client-3");

      const result = await linkExistingClientsToResource(db, MCP_RESOURCE);

      expect(result.clientsLinked).toBe(3);
      const links = await db.select().from(oauthClientResources);
      expect(links.map((l) => l.clientId).sort()).toEqual(["client-1", "client-2", "client-3"]);
    });
  });

  // The Docker entrypoint runs the migration on every boot, so this reruns constantly.
  test("is idempotent across repeated runs", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seedClient(db, "client-1");

      const first = await linkExistingClientsToResource(db, MCP_RESOURCE);
      const second = await linkExistingClientsToResource(db, MCP_RESOURCE);

      expect(first).toEqual({ resourceCreated: true, clientsLinked: 1 });
      expect(second).toEqual({ resourceCreated: false, clientsLinked: 0 });
      expect(await db.select().from(oauthClientResources)).toHaveLength(1);
      expect(await db.select().from(oauthResources)).toHaveLength(1);
    });
  });

  test("adds only the missing links when some clients are already linked", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seedClient(db, "already-linked");
      await linkExistingClientsToResource(db, MCP_RESOURCE);
      await seedClient(db, "newly-found");

      const result = await linkExistingClientsToResource(db, MCP_RESOURCE);

      expect(result).toEqual({ resourceCreated: false, clientsLinked: 1 });
      expect(await db.select().from(oauthClientResources)).toHaveLength(2);
    });
  });

  test("does nothing when there are no pre-existing clients", async () => {
    await withTestAuth({}, async ({ db }) => {
      const result = await linkExistingClientsToResource(db, MCP_RESOURCE);

      expect(result).toEqual({ resourceCreated: true, clientsLinked: 0 });
      expect(await db.select().from(oauthClientResources)).toHaveLength(0);
    });
  });
});
