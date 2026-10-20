import * as v from "valibot";

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

export const CreateTaskInputSchema = v.object({
  title: TaskTitleSchema,
  notes: v.optional(TaskNotesSchema),
});
export type CreateTaskInput = v.InferOutput<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = v.pipe(
  v.object({
    title: v.optional(TaskTitleSchema),
    notes: v.optional(v.nullable(TaskNotesSchema)),
  }),
  v.check(
    (input) => input.title !== undefined || input.notes !== undefined,
    "Provide a title or notes to update",
  ),
);
export type UpdateTaskInput = v.InferOutput<typeof UpdateTaskInputSchema>;

export const ToggleTaskInputSchema = v.object({ done: v.boolean() });
export type ToggleTaskInput = v.InferOutput<typeof ToggleTaskInputSchema>;
