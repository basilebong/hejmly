import type { ProjectId } from "@hejmly/app-todo/shared";

export const PROJECTS_QUERY_KEY = ["todo", "projects"] as const;

export const projectQueryKey = (id: ProjectId) => ["todo", "project", id] as const;

export const CREATE_PROJECT_KEY = ["todo", "create-project"] as const;

export const DELETE_PROJECT_KEY = ["todo", "delete-project"] as const;

export const projectMutationsKey = (id: ProjectId) => ["todo", "project", id] as const;

export const createTaskKey = (id: ProjectId) =>
  [...projectMutationsKey(id), "create-task"] as const;

export const deleteTaskKey = (id: ProjectId) =>
  [...projectMutationsKey(id), "delete-task"] as const;
