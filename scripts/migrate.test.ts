import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createDb } from "../packages/core/src/server/db/index.ts";

const repoRoot = resolve(import.meta.dirname, "..");

type Journal = { entries: { idx: number }[] };

const isJournal = (value: unknown): value is Journal =>
  typeof value === "object" &&
  value !== null &&
  "entries" in value &&
  Array.isArray(value.entries) &&
  value.entries.every(
    (e: unknown) => typeof e === "object" && e !== null && "idx" in e && typeof e.idx === "number",
  );

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const migratedThrough = (lastIdx: number): string => {
  const dir = mkdtempSync(join(tmpdir(), "hejmly-migrate-"));
  scratch.push(dir);
  const folder = join(dir, "drizzle");
  cpSync(join(repoRoot, "drizzle"), folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal: unknown = JSON.parse(readFileSync(journalPath, "utf8"));
  if (!isJournal(journal)) throw new Error(`unexpected journal shape in ${journalPath}`);
  writeFileSync(
    journalPath,
    JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= lastIdx) }),
  );
  const dbPath = join(dir, "app.db");
  const db = createDb({ path: dbPath });
  migrate(db, { migrationsFolder: folder });
  db.$client.close();
  return dbPath;
};

const runMigrate = (dbPath: string) =>
  Bun.spawnSync(["bun", "./scripts/migrate.ts"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_PATH: dbPath, BETTER_AUTH_URL: "http://localhost:5173" },
  });

describe("scripts/migrate.ts", () => {
  test("upgrades a clean database", () => {
    const dbPath = migratedThrough(9);
    const run = runMigrate(dbPath);
    expect(run.exitCode).toBe(0);
  });

  test("an orphaned author stops the upgrade with an actionable message and changes nothing", () => {
    const dbPath = migratedThrough(9);
    const raw = new Database(dbPath);
    raw.exec("PRAGMA foreign_keys = OFF");
    raw.exec(
      `INSERT INTO grocery_items (id,name,status_json,added_by_user_id,created_at,updated_at) VALUES ('g1','Milk','{"kind":"pending"}','ghost',1,1)`,
    );
    const appliedBefore = raw.query("SELECT COUNT(*) AS n FROM __drizzle_migrations").get();
    raw.close();

    const run = runMigrate(dbPath);
    const stderr = run.stderr.toString();

    expect(run.exitCode).not.toBe(0);
    expect(stderr).toContain("grocery_items");
    expect(stderr).toContain("users");
    expect(stderr).toContain("PRAGMA foreign_key_check");

    const after = new Database(dbPath);
    expect(after.query("SELECT COUNT(*) AS n FROM __drizzle_migrations").get()).toEqual(
      appliedBefore,
    );
    expect(after.query("SELECT id FROM grocery_items").all()).toEqual([{ id: "g1" }]);
    after.close();
  });
});
