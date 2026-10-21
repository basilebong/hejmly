import { index, integer, sqliteTable, text } from "@hejmly/core/server/drizzle";
import { users } from "@hejmly/core/server/schema";

export const groceryItems = sqliteTable(
  "grocery_items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    statusJson: text("status_json").notNull(),
    addedByUserId: text("added_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    purchasedAt: integer("purchased_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    purchasedAtIdx: index("grocery_items_purchased_at_idx").on(t.purchasedAt),
    createdAtIdx: index("grocery_items_created_at_idx").on(t.createdAt),
  }),
);

export type GroceryItemRow = typeof groceryItems.$inferSelect;
export type GroceryItemInsert = typeof groceryItems.$inferInsert;
