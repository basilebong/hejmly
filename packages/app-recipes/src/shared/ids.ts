import * as v from "valibot";

export const ID_MAX_LENGTH = 64;

export const RecipeIdSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(ID_MAX_LENGTH),
  v.brand("RecipeId"),
);
export type RecipeId = v.InferOutput<typeof RecipeIdSchema>;
export const parseRecipeId = (raw: unknown): RecipeId => v.parse(RecipeIdSchema, raw);
