import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: [
    "./packages/core/src/server/auth/schema.ts",
    "./packages/core/src/server/audit/schema.ts",
    "./packages/core/src/server/idempotency/schema.ts",
    "./packages/core/src/server/push/schema.ts",
    "./packages/core/src/server/db/schema.ts",
    "./packages/app-*/src/server/schema.ts",
  ],
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH ?? "./data/app.db",
  },
  verbose: true,
  strict: true,
});
