import type { UserId } from "@hejmly/core/shared";
import type { ProjectId, TaskId } from "./ids.ts";
import type { TaskStatus } from "./state.ts";

export type TodoAuthor =
  | { kind: "user"; id: UserId; name: string; initial: string }
  | { kind: "unknown"; name: string; initial: string };

export type TaskCounts = { open: number; done: number };

export type Project = {
  id: ProjectId;
  name: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
  createdBy: TodoAuthor;
  taskCounts: TaskCounts;
};

export type Task = {
  id: TaskId;
  projectId: ProjectId;
  title: string;
  notes: string | null;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  addedBy: TodoAuthor;
};

export type ProjectWithTasks = { project: Project; tasks: Task[] };
