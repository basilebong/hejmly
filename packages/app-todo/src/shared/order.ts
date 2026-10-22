import type { DueDate } from "./due.ts";

export const orderOpenTasks = <T extends { dueOn: DueDate | null }>(tasks: readonly T[]): T[] => {
  const dated = tasks.filter((t) => t.dueOn !== null);
  const undated = tasks.filter((t) => t.dueOn === null);
  const byDue = [...dated].sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  return [...byDue, ...undated];
};
