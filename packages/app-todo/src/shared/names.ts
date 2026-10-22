import type { UserId } from "@hejmly/core/shared";
import type { TodoMember } from "./types.ts";

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

const firstNameKey = (name: string): string => firstName(name).toLocaleLowerCase();

export const assigneeLabels = (
  tasks: readonly { assignee: Pick<TodoMember, "id" | "name"> | null }[],
): Map<UserId, string> => {
  const people = new Map<UserId, string>();
  for (const t of tasks) if (t.assignee !== null) people.set(t.assignee.id, t.assignee.name);
  const idsByFirst = new Map<string, Set<UserId>>();
  for (const [id, name] of people) {
    const key = firstNameKey(name);
    idsByFirst.set(key, (idsByFirst.get(key) ?? new Set<UserId>()).add(id));
  }
  const labels = new Map<UserId, string>();
  for (const [id, name] of people) {
    labels.set(id, (idsByFirst.get(firstNameKey(name))?.size ?? 0) > 1 ? name : firstName(name));
  }
  return labels;
};
