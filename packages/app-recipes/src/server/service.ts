import type { Db } from "@hejmly/core/server";
import { desc, eq } from "@hejmly/core/server/drizzle";
import { users } from "@hejmly/core/server/schema";
import { err, ok, type Result, type UserId } from "@hejmly/core/shared";
import { ulid } from "ulid";
import {
  type CreateRecipeInput,
  parseRecipeId,
  type Recipe,
  type RecipeError,
  type RecipeId,
  type RecipeSummary,
} from "../shared/index.ts";
import { recipes } from "./schema.ts";
import { rowToRecipe, rowToSummary, serializeIngredients, serializeSteps } from "./serialize.ts";

export type RecipeService = {
  list(): Promise<RecipeSummary[]>;
  get(id: RecipeId): Promise<Result<Recipe, RecipeError>>;
  create(input: CreateRecipeInput, by: UserId): Promise<Result<Recipe, RecipeError>>;
  update(id: RecipeId, input: CreateRecipeInput): Promise<Result<Recipe, RecipeError>>;
  remove(id: RecipeId): Promise<Result<{ id: RecipeId }, RecipeError>>;
};

const authorColumns = { id: users.id, name: users.name, email: users.email } as const;

export const createRecipeService = (db: Db): RecipeService => ({
  async list() {
    const rows = await db
      .select({ recipe: recipes, author: authorColumns })
      .from(recipes)
      .leftJoin(users, eq(users.id, recipes.createdByUserId))
      .orderBy(desc(recipes.createdAt));
    return rows.map((r) => rowToSummary(r.recipe, r.author));
  },

  async get(id) {
    const rows = await db
      .select({ recipe: recipes, author: authorColumns })
      .from(recipes)
      .leftJoin(users, eq(users.id, recipes.createdByUserId))
      .where(eq(recipes.id, id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return err({ kind: "not_found", id });
    return ok(rowToRecipe(row.recipe, row.author));
  },

  async create(input, by) {
    const now = new Date();
    const id = parseRecipeId(ulid());
    const inserted = await db
      .insert(recipes)
      .values({
        id,
        title: input.title,
        description: input.description,
        image: input.image ?? null,
        category: input.category,
        minutes: input.minutes,
        serves: input.serves,
        ingredientsJson: serializeIngredients(input.ingredients),
        stepsJson: serializeSteps(input.steps),
        createdByUserId: by,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) return err({ kind: "not_found", id });
    const authorRows = await db.select(authorColumns).from(users).where(eq(users.id, by)).limit(1);
    return ok(rowToRecipe(row, authorRows[0] ?? null));
  },

  async update(id, input) {
    const updated = await db
      .update(recipes)
      .set({
        title: input.title,
        description: input.description,
        image: input.image ?? null,
        category: input.category,
        minutes: input.minutes,
        serves: input.serves,
        ingredientsJson: serializeIngredients(input.ingredients),
        stepsJson: serializeSteps(input.steps),
      })
      .where(eq(recipes.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) return err({ kind: "not_found", id });
    const authorRows = await db
      .select(authorColumns)
      .from(users)
      .where(eq(users.id, row.createdByUserId))
      .limit(1);
    return ok(rowToRecipe(row, authorRows[0] ?? null));
  },

  async remove(id) {
    const deleted = await db
      .delete(recipes)
      .where(eq(recipes.id, id))
      .returning({ id: recipes.id });
    const row = deleted[0];
    if (row === undefined) return err({ kind: "not_found", id });
    return ok({ id: parseRecipeId(row.id) });
  },
});
