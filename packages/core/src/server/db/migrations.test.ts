import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../drizzle");

const sqlFiles = (): string[] =>
  readdirSync(migrationsFolder)
    .filter((f) => f.endsWith(".sql"))
    .sort();

const applyMigration = (db: Database, file: string): void => {
  for (const statement of readFileSync(`${migrationsFolder}/${file}`, "utf8").split(
    "--> statement-breakpoint",
  )) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) db.exec(trimmed);
  }
};

type SchemaRow = { type: string; name: string; sql: string | null };

const schemaOf = (db: Database): string =>
  db
    .query<SchemaRow, []>(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all()
    .map((r) => `${r.type} ${r.name}\n${(r.sql ?? "").replace(/\s+/g, " ").trim()}`)
    .join("\n");

// The app opens every connection with foreign keys enforced, and drizzle runs each
// migration inside a transaction, where `PRAGMA foreign_keys` is a no-op. A table
// rebuild that drops a parent therefore cascades into its children for real.
const upgradedFromPreviousRelease = (): Database => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of sqlFiles().filter((f) => !f.startsWith("0007"))) applyMigration(db, f);

  db.exec(
    `INSERT INTO users (id,name,email,email_verified,created_at,updated_at) VALUES ('u1','B','b@e.com',1,1750000000000,1750000000000)`,
  );
  db.exec(
    `INSERT INTO accounts (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ('a1','google-sub','google','u1','PW',1750000000000,1750000000000)`,
  );
  db.exec(
    `INSERT INTO oauth_clients (id,client_id,name,redirect_uris,created_at) VALUES ('c1','client-1','Claude','["https://claude.ai/cb"]',1750000000000)`,
  );
  db.exec(
    `INSERT INTO oauth_consents (id,client_id,user_id,scopes,created_at,updated_at) VALUES ('cons1','client-1','u1','["openid"]',1750000000000,1750000000000)`,
  );
  db.exec(
    `INSERT INTO oauth_refresh_tokens (id,token,client_id,user_id,scopes,created_at,expires_at) VALUES ('r1','rt-1','client-1','u1','["openid"]',1750000000000,1750003600000)`,
  );
  db.exec(
    `INSERT INTO oauth_access_tokens (id,token,client_id,user_id,scopes,created_at,expires_at,refresh_id) VALUES ('t1','at-1','client-1','u1','["openid"]',1750000000000,1750000900000,'r1')`,
  );
  db.exec(
    `INSERT INTO oauth_access_tokens (id,token,client_id,user_id,scopes,created_at,expires_at) VALUES ('t2',NULL,'client-1','u1','["openid"]',1750000000000,1750000900000)`,
  );

  db.exec("BEGIN");
  applyMigration(db, sqlFiles().find((f) => f.startsWith("0007")) ?? "");
  db.exec("COMMIT");
  return db;
};

const rows = (db: Database, sql: string): Record<string, unknown>[] =>
  db.query<Record<string, unknown>, []>(sql).all();

describe("migration 0007 against a populated pre-upgrade database", () => {
  test("keeps an access token that is linked to a refresh token", () => {
    const db = upgradedFromPreviousRelease();
    expect(rows(db, "SELECT id, refresh_id FROM oauth_access_tokens ORDER BY id")).toEqual([
      { id: "t1", refresh_id: "r1" },
    ]);
  });

  test("drops only the rows whose token became NOT NULL", () => {
    const db = upgradedFromPreviousRelease();
    expect(rows(db, "SELECT COUNT(*) AS n FROM oauth_access_tokens WHERE id = 't2'")).toEqual([
      { n: 0 },
    ]);
  });

  test("keeps refresh tokens and consents", () => {
    const db = upgradedFromPreviousRelease();
    expect(rows(db, "SELECT COUNT(*) AS n FROM oauth_refresh_tokens")).toEqual([{ n: 1 }]);
    expect(rows(db, "SELECT COUNT(*) AS n FROM oauth_consents")).toEqual([{ n: 1 }]);
  });

  test("backfills the account issuer better-auth computes and keeps the other columns", () => {
    const db = upgradedFromPreviousRelease();
    expect(rows(db, "SELECT issuer, account_id, password FROM accounts")).toEqual([
      { issuer: "local:oauth:google", account_id: "google-sub", password: "PW" },
    ]);
  });

  test("leaves no stash table behind and passes a foreign key check", () => {
    const db = upgradedFromPreviousRelease();
    expect(
      rows(db, "SELECT name FROM sqlite_master WHERE name LIKE '__stash%' OR name LIKE '__new%'"),
    ).toEqual([]);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  test("produces the same schema as a database built from scratch", () => {
    const fresh = new Database(":memory:");
    fresh.exec("PRAGMA foreign_keys = ON");
    for (const f of sqlFiles()) applyMigration(fresh, f);

    expect(schemaOf(upgradedFromPreviousRelease())).toBe(schemaOf(fresh));
  });
});
