import { describe, expect, test } from "bun:test";
import {
  localRowStates,
  type Project,
  type ProjectWithTasks,
  parseProjectId,
  parseTaskId,
  type Task,
  type TaskId,
} from "@hejmly/app-todo/shared";
import { parseUserId } from "@hejmly/core/shared";
import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";

import { TodoApiError } from "@/lib/todo-api";
import {
  projectDetailQuery,
  projectMutations,
  projectsQuery,
  removeProjectMutation,
  type TodoApi,
  type TodoCacheEnv,
} from "./cache.ts";
import { createTaskKey, PROJECTS_QUERY_KEY, projectQueryKey } from "./keys.ts";

const P = parseProjectId("p1");
const me = { kind: "user", id: parseUserId("u1"), name: "Basile", initial: "B" } as const;

const project: Project = {
  id: P,
  name: "Garden",
  description: null,
  createdAt: 1,
  updatedAt: 1,
  createdBy: me,
  taskCounts: { open: 2, done: 0 },
};

const task = (id: string, title: string): Task => ({
  id: parseTaskId(id),
  projectId: P,
  title,
  notes: null,
  status: { kind: "open" },
  createdAt: 1,
  updatedAt: 1,
  addedBy: me,
});

const unexpected = (name: string) => () => Promise.reject(new Error(`unexpected ${name} call`));

const baseApi: TodoApi = {
  fetchProjects: unexpected("fetchProjects"),
  fetchProject: unexpected("fetchProject"),
  createProject: unexpected("createProject"),
  updateProject: unexpected("updateProject"),
  deleteProject: unexpected("deleteProject"),
  createTask: unexpected("createTask"),
  setTaskDone: unexpected("setTaskDone"),
  updateTask: unexpected("updateTask"),
  deleteTask: unexpected("deleteTask"),
};

const harness = (api: Partial<TodoApi>) => {
  const qc = new QueryClient({
    defaultOptions: { queries: { gcTime: Number.POSITIVE_INFINITY }, mutations: { retry: 0 } },
  });
  const notices: string[] = [];
  const env: TodoCacheEnv = {
    qc,
    api: { ...baseApi, ...api },
    online: () => true,
    notify: {
      error: (m) => notices.push(`error: ${m}`),
      info: (m) => notices.push(`info: ${m}`),
      success: (m) => notices.push(`success: ${m}`),
    },
    author: () => me,
  };
  const mutations = projectMutations(env, P, () => {});
  return { qc, env, notices, mutations };
};

const idle = async (qc: QueryClient): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    if (qc.isFetching() === 0 && qc.isMutating() === 0) return;
  }
  throw new Error("query client never went idle");
};

const tick = () => new Promise((r) => setTimeout(r, 0));

const detailIds = (qc: QueryClient): TaskId[] =>
  qc.getQueryData<ProjectWithTasks>(projectQueryKey(P))?.tasks.map((t) => t.id) ?? [];

const watchDetail = async (h: ReturnType<typeof harness>) => {
  const observer = new QueryObserver(h.qc, projectDetailQuery(h.env, P));
  const unsubscribe = observer.subscribe(() => {});
  await idle(h.qc);
  return unsubscribe;
};

describe("todo cache lifecycle", () => {
  test("a failed task delete keeps the restored row after the settle refetch", async () => {
    const A = task("a", "Dig");
    const B = task("b", "Sow");
    const h = harness({
      fetchProject: async () => ({ project, tasks: [A, B] }),
      deleteTask: () => Promise.reject(new TodoApiError(500, "boom")),
    });
    const stop = await watchDetail(h);

    await new MutationObserver(h.qc, h.mutations.removeTask).mutate(A.id).catch(() => {});
    await idle(h.qc);

    expect(detailIds(h.qc)).toEqual([A.id, B.id]);
    expect(h.notices).toEqual(["error: Could not remove task"]);
    stop();
  });

  test("a failed project delete keeps the project on the list after the settle refetch", async () => {
    const other: Project = { ...project, id: parseProjectId("p2"), name: "Taxes" };
    const h = harness({
      fetchProjects: async () => [project, other],
      deleteProject: () => Promise.reject(new TodoApiError(500, "boom")),
    });
    const observer = new QueryObserver(h.qc, projectsQuery(h.env));
    const stop = observer.subscribe(() => {});
    await idle(h.qc);

    await new MutationObserver(h.qc, removeProjectMutation(h.env)).mutate(P).catch(() => {});
    await idle(h.qc);

    expect(h.qc.getQueryData<Project[]>(PROJECTS_QUERY_KEY)?.map((p) => p.id)).toEqual([
      P,
      other.id,
    ]);
    stop();
  });

  test("a failed create is retryable as soon as it fails, not after the refetch lands", async () => {
    const A = task("a", "Dig");
    const refetch = Promise.withResolvers<ProjectWithTasks>();
    let calls = 0;
    const h = harness({
      fetchProject: () => {
        calls += 1;
        return calls === 1 ? Promise.resolve({ project, tasks: [A] }) : refetch.promise;
      },
      createTask: () => Promise.reject(new TodoApiError(500, "boom")),
    });
    const stop = await watchDetail(h);
    const tempId = parseTaskId("tmp_new");

    void new MutationObserver(h.qc, h.mutations.createTask)
      .mutate({ input: { title: "Sow" }, tempId })
      .catch(() => {});
    for (let i = 0; i < 20; i += 1) await tick();

    const attempts = h.qc
      .getMutationCache()
      .findAll({ mutationKey: createTaskKey(P) })
      .map((m) => ({ localId: tempId, status: m.state.status, submittedAt: m.state.submittedAt }));
    expect(localRowStates(attempts).get(tempId)).toEqual({ kind: "error" });

    refetch.resolve({ project, tasks: [A] });
    await idle(h.qc);
    expect(detailIds(h.qc)).toEqual([A.id, tempId]);
    stop();
  });

  test("retrying a failed create reuses its local id as the idempotency key and lists it once", async () => {
    const A = task("a", "Dig");
    const saved = task("s1", "Sow");
    const keys: string[] = [];
    let server: Task[] = [A];
    const h = harness({
      fetchProject: async () => ({ project, tasks: server }),
      createTask: (_p, _input, key) => {
        keys.push(key);
        if (keys.length === 1) return Promise.reject(new TodoApiError(500, "boom"));
        server = [A, saved];
        return Promise.resolve(saved);
      },
    });
    const stop = await watchDetail(h);
    const tempId = parseTaskId("tmp_new");
    const vars = { input: { title: "Sow" }, tempId };

    await new MutationObserver(h.qc, h.mutations.createTask).mutate(vars).catch(() => {});
    await idle(h.qc);
    await new MutationObserver(h.qc, h.mutations.createTask).mutate(vars);
    await idle(h.qc);

    expect(keys).toEqual([tempId, tempId]);
    expect(detailIds(h.qc)).toEqual([A.id, saved.id]);
    stop();
  });

  test("a failed edit rolls back only its own fields, keeping a toggle that succeeded meanwhile", async () => {
    const A = task("a", "Dig");
    const doneA: Task = { ...A, status: { kind: "done", doneAt: 5, doneBy: me.id } };
    const edit = Promise.withResolvers<Task>();
    const refetch = Promise.withResolvers<ProjectWithTasks>();
    let calls = 0;
    const h = harness({
      fetchProject: () => {
        calls += 1;
        return calls === 1 ? Promise.resolve({ project, tasks: [A] }) : refetch.promise;
      },
      updateTask: () => edit.promise,
      setTaskDone: async () => doneA,
    });
    const stop = await watchDetail(h);

    const editing = new MutationObserver(h.qc, h.mutations.editTask)
      .mutate({ taskId: A.id, input: { title: "Dig deep" } })
      .catch(() => {});
    await new MutationObserver(h.qc, h.mutations.toggleTask).mutate({ taskId: A.id, done: true });
    edit.reject(new TodoApiError(500, "boom"));
    await editing;
    for (let i = 0; i < 20; i += 1) await tick();

    const current = h.qc.getQueryData<ProjectWithTasks>(projectQueryKey(P))?.tasks[0];
    expect(current?.title).toBe("Dig");
    expect(current?.status.kind).toBe("done");

    refetch.resolve({ project, tasks: [doneA] });
    await idle(h.qc);
    stop();
  });

  test("overlapping mutations refetch the project once, after the last one settles", async () => {
    const A = task("a", "Dig");
    const B = task("b", "Sow");
    let fetches = 0;
    const h = harness({
      fetchProject: async () => {
        fetches += 1;
        return { project, tasks: [A, B] };
      },
      setTaskDone: async (id, done) => ({
        ...(id === A.id ? A : B),
        status: done ? { kind: "done", doneAt: 5, doneBy: me.id } : { kind: "open" },
      }),
    });
    const stop = await watchDetail(h);
    expect(fetches).toBe(1);

    await Promise.all([
      new MutationObserver(h.qc, h.mutations.toggleTask).mutate({ taskId: A.id, done: true }),
      new MutationObserver(h.qc, h.mutations.toggleTask).mutate({ taskId: B.id, done: true }),
    ]);
    await idle(h.qc);

    expect(fetches).toBe(2);
    stop();
  });
});
