import {
  type CreateProjectInput,
  type CreateTaskInput,
  mergeServerRows,
  type Project,
  type ProjectId,
  ProjectIdSchema,
  type ProjectWithTasks,
  settleLocalRow,
  type Task,
  type TaskId,
  TaskIdSchema,
  type TaskTransition,
  type TodoMember,
  transition,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from "@hejmly/app-todo/shared";
import type { UserId } from "@hejmly/core/shared";
import {
  hashKey,
  mutationOptions,
  type QueryClient,
  type QueryKey,
  queryOptions,
} from "@tanstack/react-query";

import type { SessionAuthor } from "@/lib/session-author";
import { TodoApiError } from "@/lib/todo-api";
import {
  CREATE_PROJECT_KEY,
  createTaskKey,
  DELETE_PROJECT_KEY,
  deleteTaskKey,
  MEMBERS_QUERY_KEY,
  PROJECTS_QUERY_KEY,
  projectMutationsKey,
  projectQueryKey,
} from "./keys.ts";
import { pendingIds } from "./mutation-state.ts";

export type TodoApi = {
  fetchMembers: () => Promise<TodoMember[]>;
  fetchProjects: () => Promise<Project[]>;
  fetchProject: (id: ProjectId) => Promise<ProjectWithTasks>;
  createProject: (input: CreateProjectInput, idempotencyKey: string) => Promise<Project>;
  updateProject: (id: ProjectId, input: UpdateProjectInput) => Promise<Project>;
  deleteProject: (id: ProjectId) => Promise<void>;
  createTask: (
    projectId: ProjectId,
    input: CreateTaskInput,
    idempotencyKey: string,
  ) => Promise<Task>;
  setTaskDone: (id: TaskId, done: boolean) => Promise<Task>;
  updateTask: (id: TaskId, input: UpdateTaskInput) => Promise<Task>;
  deleteTask: (id: TaskId) => Promise<void>;
};

export type Notify = {
  error: (message: string) => void;
  info: (message: string) => void;
  success: (message: string) => void;
};

export type TodoCacheEnv = {
  qc: QueryClient;
  api: TodoApi;
  online: () => boolean;
  notify: Notify;
  author: () => SessionAuthor;
};

export type CreateProjectVariables = { input: CreateProjectInput; tempId: ProjectId };
export type CreateTaskVariables = { input: CreateTaskInput; tempId: TaskId };

export const isConflict = (error: unknown): boolean =>
  error instanceof TodoApiError && error.status === 409;

export const isMissing = (error: unknown): boolean =>
  error instanceof TodoApiError && error.status === 404;

const reinsert = <T extends { id: string }>(list: readonly T[], row: T, index: number): T[] => {
  if (list.some((r) => r.id === row.id)) return [...list];
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, row);
  return next;
};

const scheduledRefreshes = new WeakMap<QueryClient, Set<string>>();

// Deferred to a macrotask on purpose. TanStack awaits onSettled *before* it moves
// the mutation out of "pending" (query-core mutation.ts: onSettled, then
// #dispatch). Refetching inside onSettled therefore (a) runs while
// pendingIds() still hides a row that onError just restored, and (b) lets two
// mutations settling in the same tick each see the other as pending, so
// neither refetches. After the timeout every finished mutation has left
// "pending". Settles landing before the timeout fires share one refresh.
const refreshAfterSettle = (
  qc: QueryClient,
  keys: readonly QueryKey[],
  whenIdle?: { mutationKey: QueryKey; queryKey: QueryKey },
): void => {
  const token = hashKey([keys, whenIdle?.queryKey ?? null]);
  const scheduled = scheduledRefreshes.get(qc) ?? new Set<string>();
  scheduledRefreshes.set(qc, scheduled);
  if (scheduled.has(token)) return;
  scheduled.add(token);
  setTimeout(() => {
    scheduled.delete(token);
    for (const queryKey of keys) void qc.invalidateQueries({ queryKey }, { cancelRefetch: false });
    if (whenIdle !== undefined && qc.isMutating({ mutationKey: whenIdle.mutationKey }) === 0) {
      void qc.invalidateQueries({ queryKey: whenIdle.queryKey }, { cancelRefetch: false });
    }
  }, 0);
};

export const membersQuery = ({ api }: TodoCacheEnv) =>
  queryOptions({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: api.fetchMembers,
    staleTime: 5 * 60_000,
  });

const memberOf = (qc: QueryClient, id: UserId | null | undefined): TodoMember | null =>
  id === null || id === undefined
    ? null
    : (qc.getQueryData<TodoMember[]>(MEMBERS_QUERY_KEY)?.find((m) => m.id === id) ?? null);

const contentPatch = (qc: QueryClient, input: UpdateTaskInput): Partial<Task> => ({
  ...(input.title !== undefined ? { title: input.title } : {}),
  ...(input.notes !== undefined ? { notes: input.notes } : {}),
  ...(input.dueOn !== undefined ? { dueOn: input.dueOn } : {}),
  ...(input.assigneeId !== undefined ? { assignee: memberOf(qc, input.assigneeId) } : {}),
});

const contentRollback = (prev: Task, input: UpdateTaskInput): Partial<Task> => ({
  ...(input.title !== undefined ? { title: prev.title } : {}),
  ...(input.notes !== undefined ? { notes: prev.notes } : {}),
  ...(input.dueOn !== undefined ? { dueOn: prev.dueOn } : {}),
  ...(input.assigneeId !== undefined ? { assignee: prev.assignee } : {}),
});

export const projectsQuery = ({ qc, api }: TodoCacheEnv) =>
  queryOptions({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: async (): Promise<Project[]> =>
      mergeServerRows(await api.fetchProjects(), qc.getQueryData<Project[]>(PROJECTS_QUERY_KEY), {
        localAt: "start",
        hidden: pendingIds(qc, DELETE_PROJECT_KEY, ProjectIdSchema),
      }),
    refetchInterval: 30_000,
  });

export const projectDetailQuery = ({ qc, api }: TodoCacheEnv, id: ProjectId) =>
  queryOptions({
    queryKey: projectQueryKey(id),
    queryFn: async (): Promise<ProjectWithTasks> => {
      const fresh = await api.fetchProject(id);
      const cached = qc.getQueryData<ProjectWithTasks>(projectQueryKey(id));
      return {
        project: fresh.project,
        tasks: mergeServerRows(fresh.tasks, cached?.tasks, {
          localAt: "end",
          hidden: pendingIds(qc, deleteTaskKey(id), TaskIdSchema),
        }),
      };
    },
    refetchInterval: 20_000,
    retry: (failures, error) => !isMissing(error) && failures < 1,
  });

export const createProjectMutation = ({ qc, api, online, notify, author }: TodoCacheEnv) =>
  mutationOptions({
    mutationKey: CREATE_PROJECT_KEY,
    mutationFn: ({ input, tempId }: CreateProjectVariables) => api.createProject(input, tempId),
    onMutate: async ({ input, tempId }) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const now = Date.now();
      const optimistic: Project = {
        id: tempId,
        name: input.name,
        description: input.description ?? null,
        createdAt: now,
        updatedAt: now,
        createdBy: author(),
        taskCounts: { open: 0, done: 0 },
      };
      qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current = []) =>
        current.some((p) => p.id === tempId)
          ? current.map((p) => (p.id === tempId ? optimistic : p))
          : [optimistic, ...current],
      );
    },
    onError: () => {
      if (!online()) return;
      notify.error("Could not create project — tap retry");
    },
    onSuccess: (saved, { tempId }) => {
      qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current = []) =>
        settleLocalRow(current, tempId, saved, "start"),
      );
    },
    onSettled: () => refreshAfterSettle(qc, [PROJECTS_QUERY_KEY]),
  });

export const removeProjectMutation = ({ qc, api, online, notify }: TodoCacheEnv) =>
  mutationOptions({
    mutationKey: DELETE_PROJECT_KEY,
    mutationFn: (projectId: ProjectId) => api.deleteProject(projectId),
    onMutate: async (projectId: ProjectId) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const list = qc.getQueryData<Project[]>(PROJECTS_QUERY_KEY) ?? [];
      const index = list.findIndex((p) => p.id === projectId);
      const prev = index >= 0 ? list[index] : undefined;
      qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current) =>
        current?.filter((p) => p.id !== projectId),
      );
      return { index, prev };
    },
    onError: (_e, _vars, ctx) => {
      if (!online()) return;
      const restore = ctx?.prev;
      if (ctx !== undefined && restore !== undefined) {
        qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current = []) =>
          reinsert(current, restore, ctx.index),
        );
      }
      notify.error("Could not delete project");
    },
    onSuccess: (_data, projectId) => {
      qc.removeQueries({ queryKey: projectQueryKey(projectId) });
      notify.success("Project deleted");
    },
    onSettled: () => refreshAfterSettle(qc, [PROJECTS_QUERY_KEY]),
  });

export const projectMutations = (
  { qc, api, online, notify, author }: TodoCacheEnv,
  id: ProjectId,
  onEdited: () => void,
) => {
  const key = projectQueryKey(id);

  const patchTasks = (fn: (tasks: Task[]) => Task[]): void => {
    qc.setQueryData<ProjectWithTasks>(key, (current) =>
      current === undefined ? current : { ...current, tasks: fn(current.tasks) },
    );
  };

  const taskById = (taskId: TaskId): Task | undefined =>
    qc.getQueryData<ProjectWithTasks>(key)?.tasks.find((t) => t.id === taskId);

  const putTask = (task: Task): void => {
    patchTasks((tasks) => tasks.map((t) => (t.id === task.id ? task : t)));
  };

  const settle = (): void =>
    refreshAfterSettle(qc, [PROJECTS_QUERY_KEY], {
      mutationKey: projectMutationsKey(id),
      queryKey: key,
    });

  const patchTask = (taskId: TaskId, fields: Partial<Task>) => {
    patchTasks((tasks) => tasks.map((t) => (t.id === taskId ? { ...t, ...fields } : t)));
  };

  const createTask = mutationOptions({
    mutationKey: createTaskKey(id),
    mutationFn: ({ input, tempId }: CreateTaskVariables) => api.createTask(id, input, tempId),
    onMutate: async ({ input, tempId }) => {
      await qc.cancelQueries({ queryKey: key });
      const now = Date.now();
      const optimistic: Task = {
        id: tempId,
        projectId: id,
        title: input.title,
        notes: input.notes ?? null,
        status: { kind: "open" },
        dueOn: input.dueOn ?? null,
        assignee: memberOf(qc, input.assigneeId),
        createdAt: now,
        updatedAt: now,
        addedBy: author(),
      };
      patchTasks((tasks) =>
        tasks.some((t) => t.id === tempId)
          ? tasks.map((t) => (t.id === tempId ? optimistic : t))
          : [...tasks, optimistic],
      );
    },
    onError: () => {
      if (!online()) return;
      notify.error("Could not add task — tap retry");
    },
    onSuccess: (saved, { tempId }) => {
      patchTasks((tasks) => settleLocalRow(tasks, tempId, saved, "end"));
    },
    onSettled: settle,
  });

  const toggleTask = mutationOptions({
    mutationKey: [...projectMutationsKey(id), "toggle"],
    mutationFn: ({ taskId, done }: { taskId: TaskId; done: boolean }) =>
      api.setTaskDone(taskId, done),
    onMutate: async ({ taskId, done }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = taskById(taskId);
      const me = author();
      const t: TaskTransition | null = !done
        ? { kind: "reopen" }
        : me.kind === "user"
          ? { kind: "complete", by: me.id, at: Date.now() }
          : null;
      if (t !== null) {
        patchTasks((tasks) =>
          tasks.map((task) => {
            if (task.id !== taskId) return task;
            const next = transition(task.status, t);
            return next.kind === "ok" ? { ...task, status: next.value } : task;
          }),
        );
      }
      return { prev };
    },
    onError: (error, { taskId }, ctx) => {
      if (!online()) return;
      if (ctx?.prev !== undefined) patchTask(taskId, { status: ctx.prev.status });
      if (isConflict(error)) notify.info("Someone already changed that task — refreshed");
      else notify.error("Could not update task");
    },
    onSuccess: putTask,
    onSettled: settle,
  });

  const editTask = mutationOptions({
    mutationKey: [...projectMutationsKey(id), "edit-task"],
    mutationFn: ({ taskId, input }: { taskId: TaskId; input: UpdateTaskInput }) =>
      api.updateTask(taskId, input),
    onMutate: async ({ taskId, input }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = taskById(taskId);
      patchTask(taskId, { ...contentPatch(qc, input), updatedAt: Date.now() });
      onEdited();
      return { prev };
    },
    onError: (_e, { taskId, input }, ctx) => {
      if (!online()) return;
      const prev = ctx?.prev;
      if (prev !== undefined) patchTask(taskId, contentRollback(prev, input));
      notify.error("Could not save task");
    },
    onSuccess: putTask,
    onSettled: settle,
  });

  const removeTask = mutationOptions({
    mutationKey: deleteTaskKey(id),
    mutationFn: (taskId: TaskId) => api.deleteTask(taskId),
    onMutate: async (taskId: TaskId) => {
      await qc.cancelQueries({ queryKey: key });
      const tasks = qc.getQueryData<ProjectWithTasks>(key)?.tasks ?? [];
      const index = tasks.findIndex((t) => t.id === taskId);
      const prev = index >= 0 ? tasks[index] : undefined;
      patchTasks((list) => list.filter((t) => t.id !== taskId));
      return { index, prev };
    },
    onError: (_e, _vars, ctx) => {
      if (!online()) return;
      const restore = ctx?.prev;
      if (ctx !== undefined && restore !== undefined) {
        patchTasks((list) => reinsert(list, restore, ctx.index));
      }
      notify.error("Could not remove task");
    },
    onSettled: settle,
  });

  const editProject = mutationOptions({
    mutationKey: [...projectMutationsKey(id), "edit"],
    mutationFn: (input: UpdateProjectInput) => api.updateProject(id, input),
    onMutate: async (input: UpdateProjectInput) => {
      await qc.cancelQueries({ queryKey: key });
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const prevProject = qc.getQueryData<ProjectWithTasks>(key)?.project;
      const prevListEntry = qc
        .getQueryData<Project[]>(PROJECTS_QUERY_KEY)
        ?.find((p) => p.id === id);
      const apply = (p: Project): Project => ({
        ...p,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedAt: Date.now(),
      });
      qc.setQueryData<ProjectWithTasks>(key, (current) =>
        current === undefined ? current : { ...current, project: apply(current.project) },
      );
      qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current) =>
        current?.map((p) => (p.id === id ? apply(p) : p)),
      );
      onEdited();
      return { prevProject, prevListEntry };
    },
    onError: (_e, input, ctx) => {
      if (!online()) return;
      const prev = ctx?.prevProject ?? ctx?.prevListEntry;
      if (prev !== undefined) {
        const undo = (p: Project): Project => ({
          ...p,
          ...(input.name !== undefined ? { name: prev.name } : {}),
          ...(input.description !== undefined ? { description: prev.description } : {}),
        });
        qc.setQueryData<ProjectWithTasks>(key, (current) =>
          current === undefined ? current : { ...current, project: undo(current.project) },
        );
        qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current) =>
          current?.map((p) => (p.id === id ? undo(p) : p)),
        );
      }
      notify.error("Could not save project");
    },
    onSettled: settle,
  });

  return { createTask, toggleTask, editTask, removeTask, editProject };
};
