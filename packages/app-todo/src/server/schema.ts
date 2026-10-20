import { index, integer, sqliteTable, text } from "@hejmly/core/server/drizzle";
import { users } from "@hejmly/core/server/schema";

export const todoProjects = sqliteTable(
  "todo_projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => ({
    createdAtIdx: index("todo_projects_created_at_idx").on(t.createdAt),
  }),
);

export const todoTasks = sqliteTable(
  "todo_tasks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => todoProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    statusJson: text("status_json").notNull(),
    addedByUserId: text("added_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    projectIdx: index("todo_tasks_project_id_idx").on(t.projectId, t.createdAt),
  }),
);

export type ProjectRow = typeof todoProjects.$inferSelect;
export type ProjectInsert = typeof todoProjects.$inferInsert;
export type TaskRow = typeof todoTasks.$inferSelect;
export type TaskInsert = typeof todoTasks.$inferInsert;
