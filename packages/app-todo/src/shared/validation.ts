import { UserIdSchema } from "@hejmly/core/shared";
import * as v from "valibot";
import { DueDateSchema } from "./due.ts";
import { ID_MAX_LENGTH } from "./ids.ts";

export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 280;
export const TASK_TITLE_MAX = 200;
export const TASK_NOTES_MAX = 1000;

export const ProjectNameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "Project name can't be empty"),
  v.maxLength(PROJECT_NAME_MAX, "Project name is too long"),
);

export const ProjectDescriptionSchema = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(PROJECT_DESCRIPTION_MAX, "Description is too long"),
);

export const TaskTitleSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "Task can't be empty"),
  v.maxLength(TASK_TITLE_MAX, "Task is too long"),
);

export const TaskNotesSchema = v.pipe(
  v.string(),
  v.trim(),
  v.maxLength(TASK_NOTES_MAX, "Notes are too long"),
);

export const CreateProjectInputSchema = v.object({
  name: ProjectNameSchema,
  description: v.optional(ProjectDescriptionSchema),
});
export type CreateProjectInput = v.InferOutput<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = v.pipe(
  v.object({
    name: v.optional(ProjectNameSchema),
    description: v.optional(v.nullable(ProjectDescriptionSchema)),
  }),
  v.check(
    (input) => input.name !== undefined || input.description !== undefined,
    "Provide a name or description to update",
  ),
);
export type UpdateProjectInput = v.InferOutput<typeof UpdateProjectInputSchema>;

export const AssigneeIdSchema = v.pipe(v.string(), v.maxLength(ID_MAX_LENGTH), UserIdSchema);

export const CreateTaskInputSchema = v.object({
  title: TaskTitleSchema,
  notes: v.optional(TaskNotesSchema),
  dueOn: v.optional(DueDateSchema),
  assigneeId: v.optional(AssigneeIdSchema),
});
export type CreateTaskInput = v.InferOutput<typeof CreateTaskInputSchema>;

export const TASK_PATCH_EMPTY = "Provide a title, notes, due date or assignee to update";

export const isTaskPatch = (input: {
  title?: unknown;
  notes?: unknown;
  dueOn?: unknown;
  assigneeId?: unknown;
}): boolean =>
  input.title !== undefined ||
  input.notes !== undefined ||
  input.dueOn !== undefined ||
  input.assigneeId !== undefined;

export const UpdateTaskInputSchema = v.pipe(
  v.object({
    title: v.optional(TaskTitleSchema),
    notes: v.optional(v.nullable(TaskNotesSchema)),
    dueOn: v.optional(v.nullable(DueDateSchema)),
    assigneeId: v.optional(v.nullable(AssigneeIdSchema)),
  }),
  v.check((input) => isTaskPatch(input), TASK_PATCH_EMPTY),
);
export type UpdateTaskInput = v.InferOutput<typeof UpdateTaskInputSchema>;

export const ToggleTaskInputSchema = v.object({ done: v.boolean() });
export type ToggleTaskInput = v.InferOutput<typeof ToggleTaskInputSchema>;
