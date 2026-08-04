import { describe, expect, test } from "bun:test";
import type { Auth, Db } from "@hejmly/core/server";
import { createAuditRecorder } from "@hejmly/core/server";
import { withTestAuth } from "@hejmly/core/server/test";
import { parseUserId, type UserId } from "@hejmly/core/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as v from "valibot";
import { createRecipeService } from "../server/index.ts";
import { CreateRecipeInputSchema } from "../shared/index.ts";
import { registerRecipeTools } from "./index.ts";

const TEST_EMAIL = "basile@example.com";

const seedUser = async (auth: Auth): Promise<UserId> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser({ name: "Basile", email: TEST_EMAIL });
  return parseUserId(user.id);
};

const connect = async (db: Db, actor: UserId): Promise<Client> => {
  const server = new McpServer({ name: "Hejmly-test", version: "1.0.0" });
  registerRecipeTools(server, {
    service: createRecipeService(db),
    actor,
    audit: createAuditRecorder(db),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

const ADD_ARGS = {
  title: "Tomato Butter Rigatoni",
  category: "Main",
  minutes: 35,
  serves: 4,
  ingredients: [{ name: "Rigatoni", quantity: "400 g" }],
  steps: [
    {
      title: "Boil",
      body: "Boil the pasta until al dente.",
      timers: [{ id: "p", minutes: 11, label: "Pasta" }],
    },
  ],
};

const recipeIdOf = (result: unknown): string => {
  if (result !== null && typeof result === "object" && "structuredContent" in result) {
    const sc = result.structuredContent;
    if (sc !== null && typeof sc === "object" && "recipe" in sc) {
      const recipe = sc.recipe;
      if (recipe !== null && typeof recipe === "object" && "id" in recipe) {
        const id = recipe.id;
        if (typeof id === "string") return id;
      }
    }
  }
  throw new Error("expected recipe.id in tool result");
};

describe("recipe MCP tools", () => {
  test("lists the registered tools", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "recipes__add",
        "recipes__get",
        "recipes__list",
        "recipes__remove",
        "recipes__update",
      ]);
    });
  });

  test("add then get returns the full recipe", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const added = await client.callTool({ name: "recipes__add", arguments: ADD_ARGS });
      expect(added.isError).toBeFalsy();
      expect(added.structuredContent).toMatchObject({
        recipe: { title: "Tomato Butter Rigatoni", category: "Main" },
      });
      const recipeId = recipeIdOf(added);

      const got = await client.callTool({ name: "recipes__get", arguments: { recipeId } });
      expect(got.structuredContent).toMatchObject({
        recipe: { steps: [{ timers: [{ minutes: 11 }] }] },
      });
    });
  });

  test("list filters by category", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      await client.callTool({ name: "recipes__add", arguments: ADD_ARGS });
      await client.callTool({
        name: "recipes__add",
        arguments: { ...ADD_ARGS, title: "Lemon Soup", category: "Starter" },
      });
      const mains = await client.callTool({
        name: "recipes__list",
        arguments: { category: "Main" },
      });
      expect(mains.structuredContent).toMatchObject({
        recipes: [{ title: "Tomato Butter Rigatoni" }],
      });
    });
  });

  test("list reports whether each recipe has an image", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const actor = await seedUser(auth);
      const service = createRecipeService(db);
      const image = "data:image/png;base64,iVBORw0KGgo=";
      const seeded = await service.create(
        v.parse(CreateRecipeInputSchema, { ...ADD_ARGS, title: "With photo", image }),
        actor,
      );
      if (seeded.kind === "err") throw new Error("failed to seed recipe with image");

      const client = await connect(db, actor);
      await client.callTool({
        name: "recipes__add",
        arguments: { ...ADD_ARGS, title: "No photo" },
      });
      const list = await client.callTool({ name: "recipes__list", arguments: {} });
      const ListSchema = v.object({
        recipes: v.array(v.object({ title: v.string(), hasImage: v.boolean() })),
      });
      const parsed = v.parse(ListSchema, list.structuredContent);
      const byTitle = new Map(parsed.recipes.map((r) => [r.title, r.hasImage]));
      expect(byTitle.get("With photo")).toBe(true);
      expect(byTitle.get("No photo")).toBe(false);
    });
  });

  test("update replaces the recipe", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const added = await client.callTool({ name: "recipes__add", arguments: ADD_ARGS });
      const recipeId = recipeIdOf(added);
      const updated = await client.callTool({
        name: "recipes__update",
        arguments: { ...ADD_ARGS, recipeId, title: "Rigatoni v2", serves: 6 },
      });
      expect(updated.isError).toBeFalsy();
      expect(updated.structuredContent).toMatchObject({
        recipe: { id: recipeId, title: "Rigatoni v2", serves: 6 },
      });
    });
  });

  test("update preserves the existing photo when the caller omits it", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const actor = await seedUser(auth);
      const service = createRecipeService(db);
      const image = "data:image/png;base64,iVBORw0KGgo=";
      const seeded = await service.create(
        v.parse(CreateRecipeInputSchema, { ...ADD_ARGS, image }),
        actor,
      );
      if (seeded.kind === "err") throw new Error("failed to seed recipe with image");
      const recipeId = seeded.value.id;

      const client = await connect(db, actor);
      const updated = await client.callTool({
        name: "recipes__update",
        arguments: { ...ADD_ARGS, recipeId, title: "Rigatoni with a photo" },
      });
      expect(updated.isError).toBeFalsy();
      expect(updated.structuredContent).toMatchObject({
        recipe: { id: recipeId, title: "Rigatoni with a photo", image },
      });
    });
  });

  test("update on a missing recipe returns an MCP error", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const result = await client.callTool({
        name: "recipes__update",
        arguments: { ...ADD_ARGS, recipeId: "does-not-exist" },
      });
      expect(result.isError).toBe(true);
    });
  });

  test("remove deletes the recipe", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const added = await client.callTool({ name: "recipes__add", arguments: ADD_ARGS });
      const recipeId = recipeIdOf(added);
      await client.callTool({ name: "recipes__remove", arguments: { recipeId } });
      const list = await client.callTool({ name: "recipes__list", arguments: {} });
      expect(list.structuredContent).toMatchObject({ recipes: [] });
    });
  });

  test("get on a missing recipe returns an MCP error", async () => {
    await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
      const client = await connect(db, await seedUser(auth));
      const result = await client.callTool({
        name: "recipes__get",
        arguments: { recipeId: "does-not-exist" },
      });
      expect(result.isError).toBe(true);
    });
  });
});
