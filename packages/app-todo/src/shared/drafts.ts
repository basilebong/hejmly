import type { UserId } from "@hejmly/core/shared";
import * as v from "valibot";
import { type DueDate, DueDateSchema } from "./due.ts";
import {
  type CreateProjectInput,
  type CreateTaskInput,
  ProjectDescriptionSchema,
  ProjectNameSchema,
  TaskNotesSchema,
  TaskTitleSchema,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from "./validation.ts";

export type DraftResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; message: string }
  | { kind: "unchanged" };

export type ProjectDraft = { name: string; description: string };
export type TaskDraft = { title: string; notes: string; dueOn: string; assigneeId: UserId | null };

type Pair = { kind: "ok"; primary: string; secondary: string | null } | DraftError;
type DraftError = { kind: "error"; message: string };

const issueOf = (issues: readonly v.BaseIssue<unknown>[]): DraftError => ({
  kind: "error",
  message: issues[0]?.message ?? "Invalid input",
});

const parsePair = (
  primarySchema: v.GenericSchema<string, string>,
  secondarySchema: v.GenericSchema<string, string>,
  primary: string,
  secondary: string,
): Pair => {
  const p = v.safeParse(primarySchema, primary);
  if (!p.success) return issueOf(p.issues);
  const s = v.safeParse(secondarySchema, secondary);
  if (!s.success) return issueOf(s.issues);
  return { kind: "ok", primary: p.output, secondary: s.output.length === 0 ? null : s.output };
};

export const parseProjectDraft = (draft: ProjectDraft): DraftResult<CreateProjectInput> => {
  const r = parsePair(ProjectNameSchema, ProjectDescriptionSchema, draft.name, draft.description);
  if (r.kind === "error") return r;
  return {
    kind: "ok",
    value:
      r.secondary === null ? { name: r.primary } : { name: r.primary, description: r.secondary },
  };
};

export const diffProjectDraft = (
  initial: { name: string; description: string | null },
  draft: ProjectDraft,
): DraftResult<UpdateProjectInput> => {
  const r = parsePair(ProjectNameSchema, ProjectDescriptionSchema, draft.name, draft.description);
  if (r.kind === "error") return r;
  const patch: { name?: string; description?: string | null } = {};
  if (r.primary !== initial.name) patch.name = r.primary;
  if (r.secondary !== initial.description) patch.description = r.secondary;
  if (patch.name === undefined && patch.description === undefined) return { kind: "unchanged" };
  return { kind: "ok", value: patch };
};

type ParsedTask = {
  title: string;
  notes: string | null;
  dueOn: DueDate | null;
  assigneeId: UserId | null;
};

const parseTaskFields = (draft: TaskDraft): { kind: "ok"; task: ParsedTask } | DraftError => {
  const r = parsePair(TaskTitleSchema, TaskNotesSchema, draft.title, draft.notes);
  if (r.kind === "error") return r;
  let dueOn: DueDate | null = null;
  if (draft.dueOn.trim().length > 0) {
    const due = v.safeParse(DueDateSchema, draft.dueOn.trim());
    if (!due.success) return issueOf(due.issues);
    dueOn = due.output;
  }
  return {
    kind: "ok",
    task: { title: r.primary, notes: r.secondary, dueOn, assigneeId: draft.assigneeId },
  };
};

export const parseTaskDraft = (draft: TaskDraft): DraftResult<CreateTaskInput> => {
  const r = parseTaskFields(draft);
  if (r.kind === "error") return r;
  const { title, notes, dueOn, assigneeId } = r.task;
  return {
    kind: "ok",
    value: {
      title,
      ...(notes === null ? {} : { notes }),
      ...(dueOn === null ? {} : { dueOn }),
      ...(assigneeId === null ? {} : { assigneeId }),
    },
  };
};

export const diffTaskDraft = (
  initial: ParsedTask,
  draft: TaskDraft,
): DraftResult<UpdateTaskInput> => {
  const r = parseTaskFields(draft);
  if (r.kind === "error") return r;
  const next = r.task;
  const patch: {
    title?: string;
    notes?: string | null;
    dueOn?: DueDate | null;
    assigneeId?: UserId | null;
  } = {};
  if (next.title !== initial.title) patch.title = next.title;
  if (next.notes !== initial.notes) patch.notes = next.notes;
  if (next.dueOn !== initial.dueOn) patch.dueOn = next.dueOn;
  if (next.assigneeId !== initial.assigneeId) patch.assigneeId = next.assigneeId;
  if (Object.keys(patch).length === 0) return { kind: "unchanged" };
  return { kind: "ok", value: patch };
};
