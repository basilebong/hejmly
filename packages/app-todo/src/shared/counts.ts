import type { TaskStatus } from "./state.ts";
import type { TaskCounts } from "./types.ts";

export const countTasks = (tasks: readonly { status: TaskStatus }[]): TaskCounts => {
  const done = tasks.filter((t) => t.status.kind === "done").length;
  return { open: tasks.length - done, done };
};
