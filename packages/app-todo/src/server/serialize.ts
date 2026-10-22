import { parseUserId, UserIdSchema } from "@hejmly/core/shared";
import * as v from "valibot";
import {
  DueDateSchema,
  type Project,
  parseProjectId,
  parseTaskId,
  type Task,
  type TaskCounts,
  type TaskStatus,
  type TodoAuthor,
  type TodoMember,
} from "../shared/index.ts";
import type { ProjectRow, TaskRow } from "./schema.ts";

export type AuthorRow = { id: string; name: string | null; email: string | null } | null;

const StoredStatusSchema = v.union([
  v.object({ kind: v.literal("open") }),
  v.object({ kind: v.literal("done"), doneAt: v.number(), doneBy: UserIdSchema }),
]);

const parseStatus = (rowId: string, raw: string): TaskStatus => {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = v.safeParse(StoredStatusSchema, parsed);
    if (result.success) return result.output;
    console.error("todo: corrupt status_json, coercing to open", { rowId, raw });
    return { kind: "open" };
  } catch (e) {
    console.error("todo: invalid status_json, coercing to open", { rowId, raw, error: e });
    return { kind: "open" };
  }
};

export const serializeStatus = (status: TaskStatus): string => JSON.stringify(status);

const initialOf = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "·";
  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  return first.charAt(0).toUpperCase();
};

export const toAuthor = (user: AuthorRow): TodoAuthor => {
  if (user === null) return { kind: "unknown", name: "Someone", initial: "·" };
  const trimmedName = user.name?.trim();
  const displayName =
    trimmedName !== undefined && trimmedName.length > 0 ? trimmedName : (user.email ?? "Someone");
  return {
    kind: "user",
    id: parseUserId(user.id),
    name: displayName,
    initial: initialOf(displayName),
  };
};

export const toMember = (user: NonNullable<AuthorRow>): TodoMember => {
  const name = user.name?.trim() ?? "";
  const shown = name.length > 0 ? name : "Member";
  return { id: parseUserId(user.id), name: shown, initial: initialOf(shown) };
};

const parseDueOn = (rowId: string, raw: string | null): Task["dueOn"] => {
  if (raw === null) return null;
  const parsed = v.safeParse(DueDateSchema, raw);
  if (parsed.success) return parsed.output;
  console.error("todo: corrupt due_on, dropping it", { rowId, raw });
  return null;
};

export const rowToProject = (
  row: ProjectRow,
  author: AuthorRow,
  counts: { total: number; done: number },
): Project => {
  const taskCounts: TaskCounts = { open: counts.total - counts.done, done: counts.done };
  return {
    id: parseProjectId(row.id),
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    createdBy: toAuthor(author),
    taskCounts,
  };
};

export const rowToTask = (row: TaskRow, author: AuthorRow, assignee: AuthorRow): Task => ({
  id: parseTaskId(row.id),
  projectId: parseProjectId(row.projectId),
  title: row.title,
  notes: row.notes,
  status: parseStatus(row.id, row.statusJson),
  dueOn: parseDueOn(row.id, row.dueOn),
  assignee: assignee === null ? null : toMember(assignee),
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
  addedBy: toAuthor(author),
});
