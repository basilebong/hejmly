import * as v from "valibot";
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
export type TaskDraft = { title: string; notes: string };

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

export const parseTaskDraft = (draft: TaskDraft): DraftResult<CreateTaskInput> => {
  const r = parsePair(TaskTitleSchema, TaskNotesSchema, draft.title, draft.notes);
  if (r.kind === "error") return r;
  return {
    kind: "ok",
    value: r.secondary === null ? { title: r.primary } : { title: r.primary, notes: r.secondary },
  };
};

export const diffTaskDraft = (
  initial: { title: string; notes: string | null },
  draft: TaskDraft,
): DraftResult<UpdateTaskInput> => {
  const r = parsePair(TaskTitleSchema, TaskNotesSchema, draft.title, draft.notes);
  if (r.kind === "error") return r;
  const patch: { title?: string; notes?: string | null } = {};
  if (r.primary !== initial.title) patch.title = r.primary;
  if (r.secondary !== initial.notes) patch.notes = r.secondary;
  if (patch.title === undefined && patch.notes === undefined) return { kind: "unchanged" };
  return { kind: "ok", value: patch };
};
