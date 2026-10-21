import { describe, expect, test } from "bun:test";
import { createDb } from "./index.ts";
import { describeForeignKeyViolations, foreignKeyViolations } from "./integrity.ts";

const withSchema = () => {
  const db = createDb({ path: ":memory:" });
  db.$client.exec("CREATE TABLE users (id text PRIMARY KEY)");
  db.$client.exec(
    "CREATE TABLE items (id text PRIMARY KEY, owner text REFERENCES users(id) ON DELETE SET NULL)",
  );
  return db;
};

describe("foreign key integrity", () => {
  test("a consistent database has no violations", () => {
    const db = withSchema();
    db.$client.exec("INSERT INTO users VALUES ('u1')");
    db.$client.exec("INSERT INTO items VALUES ('i1', 'u1'), ('i2', NULL)");
    expect(foreignKeyViolations(db)).toEqual([]);
  });

  test("rows pointing at deleted parents are reported per table and parent", () => {
    const db = withSchema();
    db.$client.exec("PRAGMA foreign_keys = OFF");
    db.$client.exec("INSERT INTO items VALUES ('i1', 'ghost'), ('i2', 'ghost')");
    expect(foreignKeyViolations(db)).toEqual([{ table: "items", parent: "users", rows: 2 }]);
  });

  test("the description names each table, the parent, and the command to list the rows", () => {
    const text = describeForeignKeyViolations("/data/app.db", [
      { table: "grocery_items", parent: "users", rows: 2 },
    ]);
    expect(text).toContain("grocery_items → users: 2 row(s)");
    expect(text).toContain('sqlite3 /data/app.db "PRAGMA foreign_key_check"');
    expect(text).toContain("Nothing was changed");
  });
});
