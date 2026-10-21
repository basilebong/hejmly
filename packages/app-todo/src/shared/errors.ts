import { match } from "ts-pattern";
import type { ProjectId, TaskId } from "./ids.ts";
import type { TaskStatus } from "./state.ts";

export type TodoError =
  | { kind: "project_not_found"; id: ProjectId }
  | { kind: "task_not_found"; id: TaskId }
  | { kind: "invalid_input"; message: string }
  | { kind: "already_in_state"; state: TaskStatus["kind"] };

export const todoErrorStatus = (e: TodoError): 400 | 404 | 409 =>
  match(e)
    .with({ kind: "project_not_found" }, () => 404 as const)
    .with({ kind: "task_not_found" }, () => 404 as const)
    .with({ kind: "invalid_input" }, () => 400 as const)
    .with({ kind: "already_in_state" }, () => 409 as const)
    .exhaustive();
