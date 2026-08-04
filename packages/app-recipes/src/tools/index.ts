import type { AuditRecorder } from "@hejmly/core/server";
import type { UserId } from "@hejmly/core/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { match } from "ts-pattern";
import * as z from "zod";
import type { RecipeService } from "../server/index.ts";
import {
  type CreateRecipeInput,
  formatMinutes,
  parseRecipeId,
  type Recipe,
  type RecipeError,
  type RecipeSummary,
} from "../shared/index.ts";

export type RecipeToolDeps = {
  service: RecipeService;
  actor: UserId;
  audit: AuditRecorder;
};

const safely = async (label: string, p: Promise<void>): Promise<void> => {
  try {
    await p;
  } catch (e) {
    console.error(`recipes ${label} failed`, e);
  }
};

const summaryText = (recipe: RecipeSummary): string =>
  `${recipe.title} [${recipe.category}, ${formatMinutes(recipe.minutes)}, serves ${recipe.serves}, by ${recipe.cook.name}] — ${recipe.id}`;

const recipeText = (recipe: Recipe): string => {
  const ingredients = recipe.ingredients.map((i) => `  - ${i.name} (${i.quantity})`).join("\n");
  const steps = recipe.steps.map((s, i) => `  ${i + 1}. ${s.title}: ${s.body}`).join("\n");
  return `${recipe.title} — ${formatMinutes(recipe.minutes)}, serves ${recipe.serves}\n\nIngredients:\n${ingredients}\n\nMethod:\n${steps}`;
};

const errorText = (error: RecipeError): string =>
  match(error)
    .with({ kind: "not_found" }, (e) => `No recipe found with id "${e.id}".`)
    .with({ kind: "invalid_input" }, (e) => e.message)
    .exhaustive();

const errorResult = (error: RecipeError) => ({
  content: [{ type: "text" as const, text: errorText(error) }],
  isError: true,
});

const ingredientShape = z.object({
  name: z.string().trim().min(1).max(120),
  quantity: z.string().trim().max(40),
  haveAtHome: z.boolean().optional(),
});

const stepShape = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  concurrent: z.boolean().optional(),
  uses: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        quantity: z.string().trim().max(40).nullable(),
      }),
    )
    .optional(),
  timers: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        minutes: z.number().int().min(1).max(1440),
        label: z.string().trim().min(1).max(80),
      }),
    )
    .optional(),
});

export const registerRecipeTools = (server: McpServer, deps: RecipeToolDeps): void => {
  const { service, actor, audit } = deps;

  server.registerTool(
    "recipes__list",
    {
      title: "List recipes",
      description: "List the household's recipes, optionally filtered by category.",
      inputSchema: { category: z.enum(["Starter", "Main", "Dessert", "Other"]).optional() },
    },
    async ({ category }) => {
      const all = await service.list();
      const recipes = category === undefined ? all : all.filter((r) => r.category === category);
      await safely(
        "audit",
        audit.record({
          userId: actor,
          action: "recipes__list",
          via: "mcp",
          metadata: { category: category ?? "all", count: recipes.length },
        }),
      );
      const text = recipes.length === 0 ? "No recipes yet." : recipes.map(summaryText).join("\n");
      return { content: [{ type: "text" as const, text }], structuredContent: { recipes } };
    },
  );

  server.registerTool(
    "recipes__get",
    {
      title: "Get a recipe",
      description: "Fetch a full recipe — ingredients and method — by id.",
      inputSchema: { recipeId: z.string().min(1) },
    },
    async ({ recipeId }) => {
      const result = await service.get(parseRecipeId(recipeId));
      if (result.kind === "err") return errorResult(result.error);
      await safely(
        "audit",
        audit.record({
          userId: actor,
          action: "recipes__get",
          via: "mcp",
          metadata: { recipeId: result.value.id },
        }),
      );
      return {
        content: [{ type: "text" as const, text: recipeText(result.value) }],
        structuredContent: { recipe: result.value },
      };
    },
  );

  server.registerTool(
    "recipes__add",
    {
      title: "Add a recipe",
      description: "Create a new recipe with ingredients and step-by-step method.",
      inputSchema: {
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).optional(),
        category: z.enum(["Starter", "Main", "Dessert", "Other"]),
        minutes: z.number().int().min(1).max(1440),
        serves: z.number().int().min(1).max(50),
        ingredients: z.array(ingredientShape).min(1),
        steps: z.array(stepShape).min(1),
      },
    },
    async ({ title, description, category, minutes, serves, ingredients, steps }) => {
      const input: CreateRecipeInput = {
        title,
        description: description ?? "",
        category,
        minutes,
        serves,
        ingredients: ingredients.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          haveAtHome: i.haveAtHome ?? false,
        })),
        steps: steps.map((s) => ({
          title: s.title,
          body: s.body,
          concurrent: s.concurrent ?? false,
          uses: (s.uses ?? []).map((u) => ({ name: u.name, quantity: u.quantity })),
          timers: (s.timers ?? []).map((t) => ({ id: t.id, minutes: t.minutes, label: t.label })),
        })),
      };
      const result = await service.create(input, actor);
      if (result.kind === "err") return errorResult(result.error);
      await safely(
        "audit",
        audit.record({
          userId: actor,
          action: "recipes__add",
          via: "mcp",
          metadata: { recipeId: result.value.id },
        }),
      );
      return {
        content: [{ type: "text" as const, text: `Added "${result.value.title}".` }],
        structuredContent: { recipe: result.value },
      };
    },
  );

  server.registerTool(
    "recipes__update",
    {
      title: "Update a recipe",
      description:
        "Replace an existing recipe's details — title, ingredients, and method — by id. The photo is preserved.",
      inputSchema: {
        recipeId: z.string().min(1),
        title: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2000).optional(),
        category: z.enum(["Starter", "Main", "Dessert", "Other"]),
        minutes: z.number().int().min(1).max(1440),
        serves: z.number().int().min(1).max(50),
        ingredients: z.array(ingredientShape).min(1),
        steps: z.array(stepShape).min(1),
      },
    },
    async ({ recipeId, title, description, category, minutes, serves, ingredients, steps }) => {
      const id = parseRecipeId(recipeId);
      const existing = await service.get(id);
      if (existing.kind === "err") return errorResult(existing.error);
      const input: CreateRecipeInput = {
        title,
        description: description ?? "",
        category,
        minutes,
        serves,
        ...(existing.value.image !== null ? { image: existing.value.image } : {}),
        ingredients: ingredients.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          haveAtHome: i.haveAtHome ?? false,
        })),
        steps: steps.map((s) => ({
          title: s.title,
          body: s.body,
          concurrent: s.concurrent ?? false,
          uses: (s.uses ?? []).map((u) => ({ name: u.name, quantity: u.quantity })),
          timers: (s.timers ?? []).map((t) => ({ id: t.id, minutes: t.minutes, label: t.label })),
        })),
      };
      const result = await service.update(id, input);
      if (result.kind === "err") return errorResult(result.error);
      await safely(
        "audit",
        audit.record({
          userId: actor,
          action: "recipes__update",
          via: "mcp",
          metadata: { recipeId: result.value.id },
        }),
      );
      return {
        content: [{ type: "text" as const, text: `Updated "${result.value.title}".` }],
        structuredContent: { recipe: result.value },
      };
    },
  );

  server.registerTool(
    "recipes__remove",
    {
      title: "Remove a recipe",
      description: "Permanently delete a recipe by id.",
      inputSchema: { recipeId: z.string().min(1) },
    },
    async ({ recipeId }) => {
      const result = await service.remove(parseRecipeId(recipeId));
      if (result.kind === "err") return errorResult(result.error);
      await safely(
        "audit",
        audit.record({
          userId: actor,
          action: "recipes__remove",
          via: "mcp",
          metadata: { recipeId: result.value.id },
        }),
      );
      return {
        content: [{ type: "text" as const, text: `Removed recipe ${result.value.id}.` }],
        structuredContent: { id: result.value.id },
      };
    },
  );
};
