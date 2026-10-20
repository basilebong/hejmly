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

// Selecting by sort order rather than "everything except <tag>" so that adding a
// later migration does not silently apply it to the pre-upgrade database first.
const migrationsBefore = (tag: string): string[] => sqlFiles().filter((f) => f < tag);

const migrationUnderTest = (tag: string): string => {
  const file = sqlFiles().find((f) => f.startsWith(tag));
  if (file === undefined) throw new Error(`no migration matching ${tag}`);
  return file;
};

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
const migratedThrough = (tag: string): Database => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of [...migrationsBefore(tag), migrationUnderTest(tag)]) applyMigration(db, f);
  return db;
};

const upgradeFrom = (tag: string, seed: (db: Database) => void): Database => {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of migrationsBefore(tag)) applyMigration(db, f);
  seed(db);
  db.exec("BEGIN");
  try {
    applyMigration(db, migrationUnderTest(tag));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return db;
};

const upgradedFromPreviousRelease = (): Database =>
  upgradeFrom("0007", (db) => {
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
  });

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
    expect(schemaOf(upgradedFromPreviousRelease())).toBe(schemaOf(migratedThrough("0007")));
  });
});

const seedUserWithAccounts = (db: Database, accounts: readonly string[]): void => {
  db.exec(
    `INSERT INTO users (id,name,email,email_verified,created_at,updated_at) VALUES ('u1','B','b@e.com',1,1750000000000,1750000000000)`,
  );
  for (const values of accounts) {
    db.exec(
      `INSERT INTO accounts (id,issuer,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ${values}`,
    );
  }
};

const upgradedFromIssuerSchema = (): Database =>
  upgradeFrom("0008", (db) =>
    seedUserWithAccounts(db, [
      `('a1','local:oauth:google','google-sub','google','u1',NULL,1750000000000,1750000000000)`,
      `('a2','local:credential','u1','credential','u1','PW',1750000000000,1750000000000)`,
    ]),
  );

describe("migration 0008 against a database that ran Better Auth 1.7.0-1.7.2", () => {
  test("drops the issuer column and keeps every account row", () => {
    const db = upgradedFromIssuerSchema();
    expect(
      rows(db, "SELECT name FROM pragma_table_info('accounts') WHERE name = 'issuer'"),
    ).toEqual([]);
    expect(
      rows(db, "SELECT id, account_id, provider_id, user_id, password FROM accounts ORDER BY id"),
    ).toEqual([
      { id: "a1", account_id: "google-sub", provider_id: "google", user_id: "u1", password: null },
      { id: "a2", account_id: "u1", provider_id: "credential", user_id: "u1", password: "PW" },
    ]);
  });

  test("restores UNIQUE(provider_id, account_id) so a racing OAuth callback cannot link twice", () => {
    const db = upgradedFromIssuerSchema();
    expect(() =>
      db.exec(
        `INSERT INTO accounts (id,account_id,provider_id,user_id,created_at,updated_at) VALUES ('a3','google-sub','google','u1',1750000000000,1750000000000)`,
      ),
    ).toThrow(/UNIQUE constraint failed: accounts.provider_id, accounts.account_id/);
  });

  test("refuses to run over duplicate (provider_id, account_id) rows instead of deleting one", () => {
    expect(() =>
      upgradeFrom("0008", (db) =>
        seedUserWithAccounts(db, [
          `('a1','https://accounts.google.com','google-sub','google','u1',NULL,1750000000000,1750000000000)`,
          `('a2','local:oauth:google','google-sub','google','u1',NULL,1750000000000,1750000000000)`,
        ]),
      ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  test("passes a foreign key check", () => {
    expect(rows(upgradedFromIssuerSchema(), "PRAGMA foreign_key_check")).toEqual([]);
  });

  test("produces the same schema as a database built from scratch", () => {
    expect(schemaOf(upgradedFromIssuerSchema())).toBe(schemaOf(migratedThrough("0008")));
  });
});

const upgradedWithHouseholdData = (): Database =>
  upgradeFrom("0010", (db) => {
    db.exec(
      `INSERT INTO users (id,name,email,email_verified,created_at,updated_at) VALUES ('u1','B','b@e.com',1,1750000000000,1750000000000), ('u2','A','a@e.com',1,1750000000000,1750000000000)`,
    );
    db.exec(
      `INSERT INTO grocery_items (id,name,description,status_json,added_by_user_id,created_at,updated_at,purchased_at) VALUES ('g1','Milk','Whole','{"kind":"pending"}','u1',1750000000001,1750000000002,NULL), ('g2','Eggs',NULL,'{"kind":"purchased","purchasedAt":1750000000009,"purchasedBy":"u1"}','u2',1750000000003,1750000000004,1750000000009)`,
    );
    db.exec(
      `INSERT INTO recipes (id,title,description,image,category,minutes,serves,ingredients_json,steps_json,created_by_user_id,created_at,updated_at) VALUES ('r1','Carbonara','Roman','data:image/png;base64,AA==','Main',25,2,'[]','[]','u1',1750000000005,1750000000006)`,
    );
  });

describe("migration 0010 against a household with grocery items and recipes", () => {
  test("keeps every grocery item and recipe column for column", () => {
    const db = upgradedWithHouseholdData();
    expect(rows(db, "SELECT * FROM grocery_items ORDER BY id")).toEqual([
      {
        id: "g1",
        name: "Milk",
        description: "Whole",
        status_json: '{"kind":"pending"}',
        added_by_user_id: "u1",
        created_at: 1750000000001,
        updated_at: 1750000000002,
        purchased_at: null,
      },
      {
        id: "g2",
        name: "Eggs",
        description: null,
        status_json: '{"kind":"purchased","purchasedAt":1750000000009,"purchasedBy":"u1"}',
        added_by_user_id: "u2",
        created_at: 1750000000003,
        updated_at: 1750000000004,
        purchased_at: 1750000000009,
      },
    ]);
    expect(rows(db, "SELECT * FROM recipes")).toEqual([
      {
        id: "r1",
        title: "Carbonara",
        description: "Roman",
        image: "data:image/png;base64,AA==",
        category: "Main",
        minutes: 25,
        serves: 2,
        ingredients_json: "[]",
        steps_json: "[]",
        created_by_user_id: "u1",
        created_at: 1750000000005,
        updated_at: 1750000000006,
      },
    ]);
  });

  test("removing a member keeps what they added and clears the author", () => {
    const db = upgradedWithHouseholdData();
    db.exec("DELETE FROM users WHERE id = 'u1'");
    expect(rows(db, "SELECT id, added_by_user_id FROM grocery_items ORDER BY id")).toEqual([
      { id: "g1", added_by_user_id: null },
      { id: "g2", added_by_user_id: "u2" },
    ]);
    expect(rows(db, "SELECT id, created_by_user_id FROM recipes")).toEqual([
      { id: "r1", created_by_user_id: null },
    ]);
  });

  test("leaves no rebuild table behind and passes a foreign key check", () => {
    const db = upgradedWithHouseholdData();
    expect(rows(db, "SELECT name FROM sqlite_master WHERE name LIKE '__new%'")).toEqual([]);
    expect(rows(db, "PRAGMA foreign_key_check")).toEqual([]);
  });

  test("produces the same schema as a database built from scratch", () => {
    expect(schemaOf(upgradedWithHouseholdData())).toBe(schemaOf(migratedThrough("0010")));
  });
});

describe("the fully migrated schema", () => {
  test("keeps UNIQUE(provider_id, account_id) on accounts", () => {
    const db = new Database(":memory:");
    for (const f of sqlFiles()) applyMigration(db, f);
    expect(
      rows(db, "SELECT sql FROM sqlite_master WHERE name = 'accounts_provider_account_unique'"),
    ).toEqual([
      {
        sql: "CREATE UNIQUE INDEX `accounts_provider_account_unique` ON `accounts` (`provider_id`,`account_id`)",
      },
    ]);
  });
});
