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
import type { CreateRecipeInput } from "../shared/index.ts";
import { createRecipeRoutes } from "./routes.ts";
import { createRecipeService } from "./service.ts";

const TEST_EMAIL = "basile@example.com";

type TestApp = Hono<{ Variables: SessionVariables }>;

type RecipeTestContext = { app: TestApp; cookie: string; userId: string; db: Db; auth: Auth };

const seedSessionCookie = async (
  auth: Auth,
  signSessionCookie: (token: string) => Promise<string>,
): Promise<{ userId: string; cookie: string }> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name: "Basile", email: TEST_EMAIL },
    googleProvisioningSource,
  );
  const session = await ctx.internalAdapter.createSession(user.id);
  const signed = await signSessionCookie(session.token);
  return { userId: user.id, cookie: `Hejmly.session_token=${signed}` };
};

const withRecipes = async (fn: (ctx: RecipeTestContext) => Promise<void>): Promise<void> => {
  await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db, signSessionCookie }) => {
    const { userId, cookie } = await seedSessionCookie(auth, signSessionCookie);
    const service = createRecipeService(db);
    const app: TestApp = new Hono<{ Variables: SessionVariables }>()
      .use("/api/*", createRequireSession(auth))
      .route("/api/recipes", createRecipeRoutes({ service }));
    await fn({ app, cookie, userId, db, auth });
  });
};

const sampleRecipe = (overrides: Partial<CreateRecipeInput> = {}): CreateRecipeInput => ({
  title: "Tomato Butter Rigatoni",
  description: "A glossy, almost-creamy tomato sauce.",
  category: "Main",
  minutes: 35,
  serves: 4,
  ingredients: [
    { name: "Rigatoni", quantity: "400 g", haveAtHome: false },
    { name: "Unsalted butter", quantity: "80 g", haveAtHome: true },
  ],
  steps: [
    {
      title: "Boil the pasta",
      body: "Bring a big pot of well-salted water to a rolling boil and cook until al dente.",
      concurrent: false,
      uses: [{ name: "Rigatoni", quantity: "400 g" }],
      timers: [{ id: "pasta", minutes: 11, label: "Rigatoni" }],
    },
  ],
  ...overrides,
});

const SAMPLE_IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAQ==";

const CookSchema = v.object({ name: v.string(), initial: v.string() });
const scalarEntries = {
  id: v.string(),
  title: v.string(),
  category: v.picklist(["Starter", "Main", "Dessert", "Other"]),
  minutes: v.number(),
  serves: v.number(),
  cook: CookSchema,
};
const SummarySchema = v.object({ ...scalarEntries, hasImage: v.boolean() });
const RecipeSchema = v.object({
  ...scalarEntries,
  description: v.string(),
  image: v.nullable(v.string()),
  ingredients: v.array(
    v.object({ name: v.string(), quantity: v.string(), haveAtHome: v.boolean() }),
  ),
  steps: v.array(
    v.object({
      title: v.string(),
      body: v.string(),
      concurrent: v.boolean(),
      uses: v.array(v.object({ name: v.string(), quantity: v.nullable(v.string()) })),
      timers: v.array(v.object({ id: v.string(), minutes: v.number(), label: v.string() })),
    }),
  ),
});
const RecipeEnvelopeSchema = v.object({ recipe: RecipeSchema });
const RecipeListSchema = v.object({ recipes: v.array(SummarySchema) });

const parseJsonBody = async <S extends v.GenericSchema>(
  res: Response,
  schema: S,
): Promise<v.InferOutput<S>> => {
  const raw: unknown = await res.json();
  return v.parse(schema, raw);
};

const postRecipe = async (
  app: TestApp,
  cookie: string,
  input: CreateRecipeInput,
): Promise<v.InferOutput<typeof RecipeSchema>> => {
  const res = await app.request("/api/recipes", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  expect(res.status).toBe(201);
  const payload = await parseJsonBody(res, RecipeEnvelopeSchema);
  return payload.recipe;
};

describe("recipe routes", () => {
  describe("auth", () => {
    test("every route is 401 without a session", async () => {
      await withRecipes(async ({ app }) => {
        const probes: Array<{ method: string; path: string; body?: unknown }> = [
          { method: "GET", path: "/api/recipes" },
          { method: "GET", path: "/api/recipes/some-id" },
          { method: "GET", path: "/api/recipes/some-id/image" },
          { method: "POST", path: "/api/recipes", body: sampleRecipe() },
          { method: "PUT", path: "/api/recipes/some-id", body: sampleRecipe() },
          { method: "DELETE", path: "/api/recipes/some-id" },
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

  describe("GET /", () => {
    test("returns an empty list when no recipes exist", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes", { headers: { cookie } });
        expect(res.status).toBe(200);
        expect(await parseJsonBody(res, RecipeListSchema)).toEqual({ recipes: [] });
      });
    });

    test("returns recipes newest-first", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const first = await postRecipe(app, cookie, sampleRecipe({ title: "First" }));
        await new Promise((r) => setTimeout(r, 5));
        const second = await postRecipe(app, cookie, sampleRecipe({ title: "Second" }));
        const res = await app.request("/api/recipes", { headers: { cookie } });
        const payload = await parseJsonBody(res, RecipeListSchema);
        expect(payload.recipes.map((r) => r.id)).toEqual([second.id, first.id]);
      });
    });

    test("summaries report whether the recipe has an image", async () => {
      await withRecipes(async ({ app, cookie }) => {
        await postRecipe(app, cookie, sampleRecipe({ title: "With photo", image: SAMPLE_IMAGE }));
        await new Promise((r) => setTimeout(r, 5));
        await postRecipe(app, cookie, sampleRecipe({ title: "No photo" }));
        const res = await app.request("/api/recipes", { headers: { cookie } });
        const payload = await parseJsonBody(res, RecipeListSchema);
        const byTitle = new Map(payload.recipes.map((r) => [r.title, r.hasImage]));
        expect(byTitle.get("With photo")).toBe(true);
        expect(byTitle.get("No photo")).toBe(false);
      });
    });
  });

  describe("POST /", () => {
    test("creates a recipe attributed to the signed-in cook", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const recipe = await postRecipe(app, cookie, sampleRecipe());
        expect(recipe.title).toBe("Tomato Butter Rigatoni");
        expect(recipe.category).toBe("Main");
        expect(recipe.image).toBeNull();
        expect(recipe.ingredients).toHaveLength(2);
        expect(recipe.steps[0]?.timers[0]).toEqual({ id: "pasta", minutes: 11, label: "Rigatoni" });
        expect(recipe.cook).toEqual({ name: "Basile", initial: "B" });
      });
    });

    test("persists an uploaded image data URL", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAQ==";
        const created = await postRecipe(app, cookie, sampleRecipe({ image }));
        expect(created.image).toBe(image);
        const res = await app.request(`/api/recipes/${created.id}`, { headers: { cookie } });
        const body = await parseJsonBody(res, RecipeEnvelopeSchema);
        expect(body.recipe.image).toBe(image);
      });
    });

    test("rejects an invalid image with 400", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(sampleRecipe({ image: "not-a-data-url" })),
        });
        expect(res.status).toBe(400);
      });
    });

    test("rejects an empty title with 400", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(sampleRecipe({ title: "" })),
        });
        expect(res.status).toBe(400);
      });
    });

    test("rejects a recipe with no ingredients with 400", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(sampleRecipe({ ingredients: [] })),
        });
        expect(res.status).toBe(400);
      });
    });

    test("rejects an unknown category with 400", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ ...sampleRecipe(), category: "Brunch" }),
        });
        expect(res.status).toBe(400);
      });
    });
  });

  describe("GET /:id", () => {
    test("returns the full recipe", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const created = await postRecipe(app, cookie, sampleRecipe());
        const res = await app.request(`/api/recipes/${created.id}`, { headers: { cookie } });
        expect(res.status).toBe(200);
        const body = await parseJsonBody(res, RecipeEnvelopeSchema);
        expect(body.recipe.id).toBe(created.id);
        expect(body.recipe.steps[0]?.uses[0]).toEqual({ name: "Rigatoni", quantity: "400 g" });
      });
    });

    test("returns 404 for an unknown recipe", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes/does-not-exist", { headers: { cookie } });
        expect(res.status).toBe(404);
      });
    });
  });

  describe("GET /:id/image", () => {
    test("serves the decoded image bytes with the stored content type", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const created = await postRecipe(app, cookie, sampleRecipe({ image: SAMPLE_IMAGE }));
        const res = await app.request(`/api/recipes/${created.id}/image`, { headers: { cookie } });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("image/jpeg");
        const body = new Uint8Array(await res.arrayBuffer());
        const expected = new Uint8Array(Buffer.from(SAMPLE_IMAGE.split(",")[1] ?? "", "base64"));
        expect(body).toEqual(expected);
      });
    });

    test("returns 404 when the recipe has no image", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const created = await postRecipe(app, cookie, sampleRecipe());
        const res = await app.request(`/api/recipes/${created.id}/image`, { headers: { cookie } });
        expect(res.status).toBe(404);
      });
    });

    test("returns 404 for an unknown recipe", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes/does-not-exist/image", {
          headers: { cookie },
        });
        expect(res.status).toBe(404);
      });
    });

    test("revalidates with an ETag and answers 304 when it matches", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const created = await postRecipe(app, cookie, sampleRecipe({ image: SAMPLE_IMAGE }));
        const first = await app.request(`/api/recipes/${created.id}/image`, {
          headers: { cookie },
        });
        const etag = first.headers.get("etag");
        expect(etag).not.toBeNull();
        const second = await app.request(`/api/recipes/${created.id}/image`, {
          headers: { cookie, "if-none-match": etag ?? "" },
        });
        expect(second.status).toBe(304);
      });
    });
  });

  describe("PUT /:id", () => {
    test("updates an existing recipe", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const created = await postRecipe(app, cookie, sampleRecipe());
        const edited = sampleRecipe({
          title: "Rigatoni, revised",
          serves: 6,
          ingredients: [{ name: "Rigatoni", quantity: "500 g", haveAtHome: false }],
        });
        const res = await app.request(`/api/recipes/${created.id}`, {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(edited),
        });
        expect(res.status).toBe(200);
        const body = await parseJsonBody(res, RecipeEnvelopeSchema);
        expect(body.recipe.id).toBe(created.id);
        expect(body.recipe.title).toBe("Rigatoni, revised");
        expect(body.recipe.serves).toBe(6);
        expect(body.recipe.ingredients).toHaveLength(1);
        expect(body.recipe.cook).toEqual({ name: "Basile", initial: "B" });
      });
    });

    test("returns 404 for an unknown recipe", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes/does-not-exist", {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(sampleRecipe()),
        });
        expect(res.status).toBe(404);
      });
    });

    test("rejects an invalid body with 400", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const created = await postRecipe(app, cookie, sampleRecipe());
        const res = await app.request(`/api/recipes/${created.id}`, {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(sampleRecipe({ title: "" })),
        });
        expect(res.status).toBe(400);
      });
    });
  });

  describe("DELETE /:id", () => {
    test("removes a recipe", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const created = await postRecipe(app, cookie, sampleRecipe());
        const res = await app.request(`/api/recipes/${created.id}`, {
          method: "DELETE",
          headers: { cookie },
        });
        expect(res.status).toBe(200);
        const list = await app.request("/api/recipes", { headers: { cookie } });
        expect(await parseJsonBody(list, RecipeListSchema)).toEqual({ recipes: [] });
      });
    });

    test("returns 404 for an unknown recipe", async () => {
      await withRecipes(async ({ app, cookie }) => {
        const res = await app.request("/api/recipes/does-not-exist", {
          method: "DELETE",
          headers: { cookie },
        });
        expect(res.status).toBe(404);
      });
    });
  });
});
