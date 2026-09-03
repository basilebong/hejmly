#!/usr/bin/env bun
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { linkExistingClientsToResource } from "../packages/core/src/server/auth/backfill.ts";
import { createDb } from "../packages/core/src/server/db/index.ts";
import { parseEnv } from "../packages/core/src/shared/env.ts";

const env = parseEnv(process.env);
const dbPath = env.DATABASE_PATH ?? "./data/app.db";

if (dbPath !== ":memory:") {
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
}

const db = createDb({ path: dbPath });
migrate(db, { migrationsFolder: "./drizzle" });

console.info(`migrate: applied migrations to ${dbPath}`);

// Runs on every boot, not just the 1.6 -> 1.7 upgrade: it is idempotent, and a
// client registered while an older image was still serving would otherwise be
// left unlinked and locked out.
//
// BETTER_AUTH_URL is optional in this schema but required by the server itself, so
// without it there is no resource identifier to link against. Skip rather than
// registering a resource under a made-up identifier that would never match.
if (env.BETTER_AUTH_URL === undefined) {
  console.warn("migrate: BETTER_AUTH_URL is unset, skipping the OAuth client resource backfill");
} else {
  const mcpResource = `${env.BETTER_AUTH_URL}/mcp`;
  const backfill = await linkExistingClientsToResource(db, mcpResource);
  if (backfill.resourceCreated || backfill.clientsLinked > 0) {
    console.info(
      `migrate: linked ${backfill.clientsLinked} existing OAuth client(s) to ${mcpResource}`,
    );
  }
}
