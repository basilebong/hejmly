import * as v from "valibot";
import {
  type Cook,
  type Ingredient,
  IngredientInputSchema,
  parseRecipeId,
  type Recipe,
  RecipeCategorySchema,
  type RecipeStep,
  type RecipeSummary,
  StepInputSchema,
} from "../shared/index.ts";
import type { RecipeRow } from "./schema.ts";

const StoredIngredientsSchema = v.array(IngredientInputSchema);
const StoredStepsSchema = v.array(StepInputSchema);

const parseIngredients = (rowId: string, raw: string): readonly Ingredient[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = v.safeParse(StoredIngredientsSchema, parsed);
    if (result.success) return result.output;
    console.error("recipes: corrupt ingredients_json, coercing to empty", { rowId });
    return [];
  } catch (e) {
    console.error("recipes: invalid ingredients_json, coercing to empty", { rowId, error: e });
    return [];
  }
};

const parseSteps = (rowId: string, raw: string): readonly RecipeStep[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = v.safeParse(StoredStepsSchema, parsed);
    if (result.success) return result.output;
    console.error("recipes: corrupt steps_json, coercing to empty", { rowId });
    return [];
  } catch (e) {
    console.error("recipes: invalid steps_json, coercing to empty", { rowId, error: e });
    return [];
  }
};

const parseCategory = (raw: string): Recipe["category"] => {
  const result = v.safeParse(RecipeCategorySchema, raw);
  return result.success ? result.output : "Other";
};

export const serializeIngredients = (ingredients: readonly Ingredient[]): string =>
  JSON.stringify(ingredients);

export const serializeSteps = (steps: readonly RecipeStep[]): string => JSON.stringify(steps);

const initialOf = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "·";
  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  return first.charAt(0).toUpperCase();
};

export const toCook = (
  user: { id: string; name: string | null; email: string | null } | null,
): Cook => {
  if (user === null) return { name: "Someone", initial: "·" };
  const trimmedName = user.name?.trim();
  const displayName =
    trimmedName !== undefined && trimmedName.length > 0 ? trimmedName : (user.email ?? "Someone");
  return { name: displayName, initial: initialOf(displayName) };
};

type AuthorRow = { id: string; name: string | null; email: string | null } | null;

export const rowToRecipe = (row: RecipeRow, author: AuthorRow): Recipe => ({
  id: parseRecipeId(row.id),
  title: row.title,
  description: row.description,
  image: row.image,
  category: parseCategory(row.category),
  minutes: row.minutes,
  serves: row.serves,
  cook: toCook(author),
  ingredients: parseIngredients(row.id, row.ingredientsJson),
  steps: parseSteps(row.id, row.stepsJson),
});

export const rowToSummary = (row: RecipeRow, author: AuthorRow): RecipeSummary => ({
  id: parseRecipeId(row.id),
  title: row.title,
  category: parseCategory(row.category),
  minutes: row.minutes,
  serves: row.serves,
  cook: toCook(author),
  hasImage: row.image !== null,
});
