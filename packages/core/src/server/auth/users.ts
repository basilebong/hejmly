import { eq } from "drizzle-orm";
import type { UserId } from "../../shared/index.ts";
import type { Db } from "../db/index.ts";
import { users } from "./schema.ts";

export const findUserEmail = async (db: Db, userId: UserId): Promise<string | null> => {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.email ?? null;
};
