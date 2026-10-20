import type { ProjectId } from "@hejmly/app-todo/shared";

export const PROJECTS_QUERY_KEY = ["todo", "projects"] as const;

export const projectQueryKey = (id: ProjectId) => ["todo", "project", id] as const;

export const TEMP_ID_PREFIX = "tmp_";

export const isTempId = (id: string): boolean => id.startsWith(TEMP_ID_PREFIX);

export const tempIdSeed = (): string => `${TEMP_ID_PREFIX}${crypto.randomUUID()}`;
