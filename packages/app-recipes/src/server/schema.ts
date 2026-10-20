import { index, integer, sqliteTable, text } from "@hejmly/core/server/drizzle";
import { users } from "@hejmly/core/server/schema";

export const recipes = sqliteTable(
  "recipes",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    image: text("image"),
    category: text("category").notNull(),
    minutes: integer("minutes").notNull(),
    serves: integer("serves").notNull(),
    ingredientsJson: text("ingredients_json").notNull(),
    stepsJson: text("steps_json").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    createdAtIdx: index("recipes_created_at_idx").on(t.createdAt),
    categoryIdx: index("recipes_category_idx").on(t.category),
  }),
);

export type RecipeRow = typeof recipes.$inferSelect;
export type RecipeInsert = typeof recipes.$inferInsert;
