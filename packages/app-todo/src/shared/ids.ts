import * as v from "valibot";

export const ProjectIdSchema = v.pipe(v.string(), v.minLength(1), v.brand("ProjectId"));
export type ProjectId = v.InferOutput<typeof ProjectIdSchema>;
export const parseProjectId = (raw: unknown): ProjectId => v.parse(ProjectIdSchema, raw);

export const TaskIdSchema = v.pipe(v.string(), v.minLength(1), v.brand("TaskId"));
export type TaskId = v.InferOutput<typeof TaskIdSchema>;
export const parseTaskId = (raw: unknown): TaskId => v.parse(TaskIdSchema, raw);
