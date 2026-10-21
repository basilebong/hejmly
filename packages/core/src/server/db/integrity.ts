import * as v from "valibot";
import type { Db } from "./index.ts";

export type ForeignKeyViolation = { table: string; parent: string; rows: number };

const CheckRowSchema = v.object({ table: v.string(), parent: v.string() });

export const foreignKeyViolations = (db: Db): ForeignKeyViolation[] => {
  const counts = new Map<string, ForeignKeyViolation>();
  for (const raw of db.$client.query("PRAGMA foreign_key_check").all()) {
    const { table, parent } = v.parse(CheckRowSchema, raw);
    const key = `${table}\u0000${parent}`;
    const seen = counts.get(key);
    counts.set(key, { table, parent, rows: (seen?.rows ?? 0) + 1 });
  }
  return [...counts.values()];
};

export const describeForeignKeyViolations = (
  dbPath: string,
  violations: readonly ForeignKeyViolation[],
): string =>
  [
    "migrate: the upgrade stopped because some rows point at rows that no longer exist:",
    ...violations.map((x) => `  ${x.table} → ${x.parent}: ${x.rows} row(s)`),
    "This usually means rows were deleted with foreign keys off (the sqlite3 CLI's default).",
    "Nothing was changed. List the rows with:",
    `  sqlite3 ${dbPath} "PRAGMA foreign_key_check"`,
    "then delete them or clear the dangling reference, and start again.",
  ].join("\n");
