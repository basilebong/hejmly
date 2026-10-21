import * as v from "valibot";

export const ID_MAX_LENGTH = 64;

export const GroceryItemIdSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(ID_MAX_LENGTH),
  v.brand("GroceryItemId"),
);
export type GroceryItemId = v.InferOutput<typeof GroceryItemIdSchema>;
export const parseGroceryItemId = (raw: unknown): GroceryItemId =>
  v.parse(GroceryItemIdSchema, raw);
