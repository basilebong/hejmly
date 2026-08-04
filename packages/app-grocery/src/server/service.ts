import type { Db } from "@hejmly/core/server";
import { and, desc, eq, isNotNull } from "@hejmly/core/server/drizzle";
import { users } from "@hejmly/core/server/schema";
import { err, isErr, ok, type Result, type UserId } from "@hejmly/core/shared";
import { ulid } from "ulid";
import {
  type CreateItemInput,
  type GroceryError,
  type GroceryItem,
  type GroceryItemId,
  parseGroceryItemId,
  transition,
  type UpdateItemInput,
} from "../shared/index.ts";
import { groceryItems } from "./schema.ts";
import { rowToItem, serializeStatus } from "./serialize.ts";

export type GroceryService = {
  list(): Promise<GroceryItem[]>;
  listPurchased(): Promise<GroceryItem[]>;
  create(input: CreateItemInput, by: UserId): Promise<Result<GroceryItem, GroceryError>>;
  update(id: GroceryItemId, input: UpdateItemInput): Promise<Result<GroceryItem, GroceryError>>;
  markPurchased(id: GroceryItemId, by: UserId): Promise<Result<GroceryItem, GroceryError>>;
  markPending(id: GroceryItemId): Promise<Result<GroceryItem, GroceryError>>;
  remove(id: GroceryItemId): Promise<Result<{ id: GroceryItemId }, GroceryError>>;
  removeIfPurchased(
    id: GroceryItemId,
  ): Promise<Result<{ id: GroceryItemId; removed: boolean }, GroceryError>>;
};

type AuthorRow = { id: string; name: string | null; email: string | null } | null;
type WithAuthor = { item: typeof groceryItems.$inferSelect; author: AuthorRow };

const authorColumns = { id: users.id, name: users.name, email: users.email } as const;

const fetchWithAuthor = async (db: Db, id: GroceryItemId): Promise<WithAuthor | null> => {
  const rows = await db
    .select({ item: groceryItems, author: authorColumns })
    .from(groceryItems)
    .leftJoin(users, eq(users.id, groceryItems.addedByUserId))
    .where(eq(groceryItems.id, id))
    .limit(1);
  return rows[0] ?? null;
};

const fetchAuthor = async (db: Db, userId: UserId): Promise<AuthorRow> => {
  const rows = await db.select(authorColumns).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
};

export const createGroceryService = (db: Db): GroceryService => ({
  async list() {
    const rows = await db
      .select({ item: groceryItems, author: authorColumns })
      .from(groceryItems)
      .leftJoin(users, eq(users.id, groceryItems.addedByUserId))
      .orderBy(desc(groceryItems.createdAt));
    return rows.map((r) => rowToItem(r.item, r.author));
  },

  async listPurchased() {
    const rows = await db
      .select({ item: groceryItems, author: authorColumns })
      .from(groceryItems)
      .leftJoin(users, eq(users.id, groceryItems.addedByUserId))
      .where(isNotNull(groceryItems.purchasedAt))
      .orderBy(desc(groceryItems.createdAt));
    return rows.map((r) => rowToItem(r.item, r.author));
  },

  async create(input, by) {
    const now = new Date();
    const id = parseGroceryItemId(ulid());
    const inserted = await db
      .insert(groceryItems)
      .values({
        id,
        name: input.name,
        description: input.description ?? null,
        statusJson: serializeStatus({ kind: "pending" }),
        addedByUserId: by,
        createdAt: now,
        updatedAt: now,
        purchasedAt: null,
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) return err({ kind: "not_found", id });
    const author = await fetchAuthor(db, by);
    return ok(rowToItem(row, author));
  },

  async update(id, input) {
    if (input.name === undefined && input.description === undefined) {
      return err({ kind: "invalid_input", message: "Provide a name or description to update" });
    }
    const existing = await fetchWithAuthor(db, id);
    if (existing === null) return err({ kind: "not_found", id });
    const patch: { name?: string; description?: string | null; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    const updated = await db
      .update(groceryItems)
      .set(patch)
      .where(eq(groceryItems.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) return err({ kind: "not_found", id });
    return ok(rowToItem(row, existing.author));
  },

  async markPurchased(id, by) {
    const existing = await fetchWithAuthor(db, id);
    if (existing === null) return err({ kind: "not_found", id });
    const current = rowToItem(existing.item, existing.author);
    const at = Date.now();
    const next = transition(current.status, { kind: "mark_purchased", by, at });
    if (isErr(next)) return err({ kind: "already_in_state", state: next.error.state });
    const updated = await db
      .update(groceryItems)
      .set({ statusJson: serializeStatus(next.value), purchasedAt: new Date(at) })
      .where(eq(groceryItems.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) return err({ kind: "not_found", id });
    return ok(rowToItem(row, existing.author));
  },

  async markPending(id) {
    const existing = await fetchWithAuthor(db, id);
    if (existing === null) return err({ kind: "not_found", id });
    const current = rowToItem(existing.item, existing.author);
    const next = transition(current.status, { kind: "mark_pending" });
    if (isErr(next)) return err({ kind: "already_in_state", state: next.error.state });
    const updated = await db
      .update(groceryItems)
      .set({ statusJson: serializeStatus(next.value), purchasedAt: null })
      .where(eq(groceryItems.id, id))
      .returning();
    const row = updated[0];
    if (row === undefined) return err({ kind: "not_found", id });
    return ok(rowToItem(row, existing.author));
  },

  async remove(id) {
    const deleted = await db
      .delete(groceryItems)
      .where(eq(groceryItems.id, id))
      .returning({ id: groceryItems.id });
    const row = deleted[0];
    if (row === undefined) return err({ kind: "not_found", id });
    return ok({ id: parseGroceryItemId(row.id) });
  },

  async removeIfPurchased(id) {
    const deleted = await db
      .delete(groceryItems)
      .where(and(eq(groceryItems.id, id), isNotNull(groceryItems.purchasedAt)))
      .returning({ id: groceryItems.id });
    return ok({ id, removed: deleted.length > 0 });
  },
});
