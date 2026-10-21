import { err, ok, type Result, type UserId } from "@hejmly/core/shared";
import { match } from "ts-pattern";

export type TaskStatus = { kind: "open" } | { kind: "done"; doneAt: number; doneBy: UserId };

export type TaskTransition = { kind: "complete"; by: UserId; at: number } | { kind: "reopen" };

export type TransitionError = { kind: "already_in_state"; state: TaskStatus["kind"] };

export const transition = (
  status: TaskStatus,
  t: TaskTransition,
): Result<TaskStatus, TransitionError> =>
  match<TaskTransition, Result<TaskStatus, TransitionError>>(t)
    .with({ kind: "complete" }, ({ by, at }) =>
      status.kind === "done"
        ? err({ kind: "already_in_state", state: "done" })
        : ok({ kind: "done", doneAt: at, doneBy: by }),
    )
    .with({ kind: "reopen" }, () =>
      status.kind === "open"
        ? err({ kind: "already_in_state", state: "open" })
        : ok({ kind: "open" }),
    )
    .exhaustive();

export const isDone = (s: TaskStatus): s is Extract<TaskStatus, { kind: "done" }> =>
  s.kind === "done";
