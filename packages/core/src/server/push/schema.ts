import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sessions, users } from "../auth/schema.ts";

export const pushVapidKeys = sqliteTable("push_vapid_keys", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    refusals: integer("refusals").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    userIdx: index("push_subscriptions_user_id_idx").on(t.userId),
    sessionIdx: index("push_subscriptions_session_id_idx").on(t.sessionId),
  }),
);

export const pushPreferences = sqliteTable(
  "push_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.topic] }) }),
);
