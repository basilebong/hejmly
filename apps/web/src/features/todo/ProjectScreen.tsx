import {
  type CreateTaskInput,
  countTasks,
  isLocalId,
  localIdSeed,
  mergeServerRows,
  type Project,
  type ProjectId,
  ProjectIdSchema,
  type ProjectWithTasks,
  parseTaskId,
  settleLocalRow,
  syncStateOf,
  type Task,
  type TaskId,
  TaskIdSchema,
  type TaskTransition,
  transition,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from "@hejmly/app-todo/shared";
import {
  AddTaskForm,
  EditProjectForm,
  EditTaskForm,
  EmptyState,
  Fab,
  ProjectActionsMenu,
  ProjectHeader,
  TaskList,
  type TaskRowHandlers,
  TasksSkeleton,
} from "@hejmly/app-todo/ui";
import { ArrowLeftIcon, ListChecksIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import * as v from "valibot";

import { BottomNav } from "@/components/BottomNav";
import { useSessionAuthor } from "@/lib/session-author";
import {
  createTask,
  deleteProject,
  deleteTask,
  fetchProject,
  setTaskDone,
  TodoApiError,
  updateProject,
  updateTask,
} from "@/lib/todo-api";
import { ConfirmDrawer } from "./ConfirmDrawer.tsx";
import { FormDrawer } from "./FormDrawer.tsx";
import {
  createTaskKey,
  DELETE_PROJECT_KEY,
  deleteTaskKey,
  PROJECTS_QUERY_KEY,
  projectMutationsKey,
  projectQueryKey,
} from "./keys.ts";
import { pendingIds, useLocalRowStates } from "./mutation-state.ts";

type DrawerState =
  | { kind: "none" }
  | { kind: "add_task" }
  | { kind: "edit_task"; id: TaskId }
  | { kind: "remove_task"; id: TaskId }
  | { kind: "edit_project" }
  | { kind: "remove_project" };

const DRAWER_NONE: DrawerState = { kind: "none" };

type CreateTaskVariables = { input: CreateTaskInput; tempId: TaskId };

const isConflict = (error: unknown): boolean =>
  error instanceof TodoApiError && error.status === 409;

const isMissing = (error: unknown): boolean =>
  error instanceof TodoApiError && error.status === 404;

const BackLink = (): ReactElement => (
  <Link
    to="/todo"
    aria-label="Back to projects"
    className="grid size-11 place-items-center rounded-full text-slate-600 transition active:bg-slate-100"
  >
    <ArrowLeftIcon size={18} weight="bold" />
  </Link>
);

const Shell = ({ children }: { children: ReactNode }): ReactElement => (
  <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
    {children}
    <BottomNav active="todo" />
  </main>
);

const Problem = ({
  title,
  hint,
  onRetry,
}: {
  title: string;
  hint: string;
  onRetry: (() => void) | null;
}): ReactElement => (
  <Shell>
    <div className="flex h-12 shrink-0 items-center bg-white px-2 pt-[env(safe-area-inset-top)]">
      <BackLink />
    </div>
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <WarningCircleIcon size={40} weight="fill" className="text-slate-300" />
      <div>
        <p className="font-medium text-base text-slate-900">{title}</p>
        <p className="mt-1 text-slate-500 text-sm">{hint}</p>
      </div>
      {onRetry !== null && (
        <button
          type="button"
          onClick={onRetry}
          className="flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-6 font-medium text-base text-white transition active:scale-[0.98]"
        >
          Try again
        </button>
      )}
    </div>
  </Shell>
);

const deleteProjectWarning = (taskCount: number): string => {
  const what =
    taskCount === 0
      ? "the project"
      : `the project and its ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
  return `This deletes ${what} for everyone in the household. It can't be undone.`;
};

export const ProjectScreen = ({ projectId }: { projectId: string }): ReactElement => {
  const parsed = v.safeParse(ProjectIdSchema, projectId);
  if (!parsed.success) {
    return <Problem title="Project not found" hint="It may have been deleted." onRetry={null} />;
  }
  return <ProjectView id={parsed.output} />;
};

const ProjectView = ({ id }: { id: ProjectId }): ReactElement => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const identity = useSessionAuthor();
  const key = projectQueryKey(id);
  const [drawer, setDrawer] = useState<DrawerState>(DRAWER_NONE);
  const localStates = useLocalRowStates(createTaskKey(id));

  const detail = useQuery({
    queryKey: key,
    queryFn: async (): Promise<ProjectWithTasks> => {
      const fresh = await fetchProject(id);
      const cached = qc.getQueryData<ProjectWithTasks>(key);
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

  const settle = async (): Promise<void> => {
    const refreshes = [qc.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY })];
    if (qc.isMutating({ mutationKey: projectMutationsKey(id) }) === 1) {
      refreshes.push(qc.invalidateQueries({ queryKey: key }));
    }
    await Promise.all(refreshes);
  };

  const create = useMutation({
    mutationKey: createTaskKey(id),
    mutationFn: ({ input, tempId }: CreateTaskVariables) => createTask(id, input, tempId),
    onMutate: async ({ input, tempId }) => {
      await qc.cancelQueries({ queryKey: key });
      const now = Date.now();
      const optimistic: Task = {
        id: tempId,
        projectId: id,
        title: input.title,
        notes: input.notes ?? null,
        status: { kind: "open" },
        createdAt: now,
        updatedAt: now,
        addedBy: identity,
      };
      patchTasks((tasks) =>
        tasks.some((t) => t.id === tempId)
          ? tasks.map((t) => (t.id === tempId ? optimistic : t))
          : [...tasks, optimistic],
      );
    },
    onError: () => {
      if (!navigator.onLine) return;
      toast.error("Could not add task — tap retry");
    },
    onSuccess: (saved, { tempId }) => {
      patchTasks((tasks) => settleLocalRow(tasks, tempId, saved, "end"));
    },
    onSettled: settle,
  });

  const toggle = useMutation({
    mutationKey: [...projectMutationsKey(id), "toggle"],
    mutationFn: ({ taskId, done }: { taskId: TaskId; done: boolean }) => setTaskDone(taskId, done),
    onMutate: async ({ taskId, done }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = taskById(taskId);
      const t: TaskTransition | null = !done
        ? { kind: "reopen" }
        : identity.kind === "user"
          ? { kind: "complete", by: identity.id, at: Date.now() }
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
    onError: (error, _vars, ctx) => {
      if (!navigator.onLine) return;
      if (ctx?.prev !== undefined) putTask(ctx.prev);
      if (isConflict(error)) toast.info("Someone already changed that task — refreshed");
      else toast.error("Could not update task");
    },
    onSuccess: putTask,
    onSettled: settle,
  });

  const edit = useMutation({
    mutationKey: [...projectMutationsKey(id), "edit-task"],
    mutationFn: ({ taskId, input }: { taskId: TaskId; input: UpdateTaskInput }) =>
      updateTask(taskId, input),
    onMutate: async ({ taskId, input }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = taskById(taskId);
      patchTasks((tasks) =>
        tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                ...(input.title !== undefined ? { title: input.title } : {}),
                ...(input.notes !== undefined ? { notes: input.notes } : {}),
                updatedAt: Date.now(),
              }
            : t,
        ),
      );
      setDrawer(DRAWER_NONE);
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (!navigator.onLine) return;
      if (ctx?.prev !== undefined) putTask(ctx.prev);
      toast.error("Could not save task");
    },
    onSuccess: putTask,
    onSettled: settle,
  });

  const removeTask = useMutation({
    mutationKey: deleteTaskKey(id),
    mutationFn: (taskId: TaskId) => deleteTask(taskId),
    onMutate: async (taskId: TaskId) => {
      await qc.cancelQueries({ queryKey: key });
      const tasks = qc.getQueryData<ProjectWithTasks>(key)?.tasks ?? [];
      const index = tasks.findIndex((t) => t.id === taskId);
      const prev = index >= 0 ? tasks[index] : undefined;
      patchTasks((list) => list.filter((t) => t.id !== taskId));
      return { index, prev };
    },
    onError: (_e, _vars, ctx) => {
      if (!navigator.onLine) return;
      const restore = ctx?.prev;
      if (ctx !== undefined && restore !== undefined) {
        patchTasks((list) => {
          if (list.some((t) => t.id === restore.id)) return list;
          const next = [...list];
          next.splice(Math.min(Math.max(ctx.index, 0), next.length), 0, restore);
          return next;
        });
      }
      toast.error("Could not remove task");
    },
    onSettled: settle,
  });

  const editProject = useMutation({
    mutationKey: [...projectMutationsKey(id), "edit"],
    mutationFn: (input: UpdateProjectInput) => updateProject(id, input),
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
      setDrawer(DRAWER_NONE);
      return { prevProject, prevListEntry };
    },
    onError: (_e, _vars, ctx) => {
      if (!navigator.onLine) return;
      const prevProject = ctx?.prevProject;
      const prevListEntry = ctx?.prevListEntry;
      if (prevProject !== undefined) {
        qc.setQueryData<ProjectWithTasks>(key, (current) =>
          current === undefined ? current : { ...current, project: prevProject },
        );
      }
      if (prevListEntry !== undefined) {
        qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current) =>
          current?.map((p) => (p.id === id ? prevListEntry : p)),
        );
      }
      toast.error("Could not save project");
    },
    onSettled: settle,
  });

  const removeProject = useMutation({
    mutationKey: DELETE_PROJECT_KEY,
    mutationFn: (projectId: ProjectId) => deleteProject(projectId),
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
      if (!navigator.onLine) return;
      const restore = ctx?.prev;
      if (ctx !== undefined && restore !== undefined) {
        qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current = []) => {
          if (current.some((p) => p.id === restore.id)) return current;
          const next = [...current];
          next.splice(Math.min(Math.max(ctx.index, 0), next.length), 0, restore);
          return next;
        });
      }
      toast.error("Could not delete project");
    },
    onSuccess: (_data, projectId) => {
      qc.removeQueries({ queryKey: projectQueryKey(projectId) });
      toast.success("Project deleted");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY }),
  });

  const tasks = detail.data?.tasks ?? [];

  useEffect(() => {
    if (drawer.kind !== "edit_task" && drawer.kind !== "remove_task") return;
    if (detail.data === undefined) return;
    if (detail.data.tasks.some((t) => t.id === drawer.id)) return;
    setDrawer(DRAWER_NONE);
    toast.info("That task was removed");
  }, [drawer, detail.data]);

  if (detail.isPending) {
    return (
      <Shell>
        <TasksSkeleton />
      </Shell>
    );
  }

  if (isMissing(detail.error)) {
    return <Problem title="Project not found" hint="It may have been deleted." onRetry={null} />;
  }

  if (detail.data === undefined) {
    return (
      <Problem
        title="Couldn't load this project"
        hint="Check your connection and try again."
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const { project } = detail.data;

  const handlersFor = (taskId: TaskId): TaskRowHandlers => ({
    onToggle: (done: boolean) => {
      if (!isLocalId(taskId)) toggle.mutate({ taskId, done });
    },
    onRetry: () => {
      const task = tasks.find((t) => t.id === taskId);
      if (task === undefined || !isLocalId(taskId)) return;
      const input: CreateTaskInput =
        task.notes === null ? { title: task.title } : { title: task.title, notes: task.notes };
      create.mutate({ input, tempId: taskId });
    },
    onDiscard: () => {
      if (isLocalId(taskId)) patchTasks((list) => list.filter((t) => t.id !== taskId));
    },
    onEdit: () => {
      if (!isLocalId(taskId)) setDrawer({ kind: "edit_task", id: taskId });
    },
    onRemove: () => {
      if (!isLocalId(taskId)) setDrawer({ kind: "remove_task", id: taskId });
    },
  });

  const editingTask = match(drawer)
    .with({ kind: "edit_task" }, ({ id: taskId }) => tasks.find((t) => t.id === taskId) ?? null)
    .with(
      { kind: "none" },
      { kind: "add_task" },
      { kind: "remove_task" },
      { kind: "edit_project" },
      { kind: "remove_project" },
      () => null,
    )
    .exhaustive();
  const removingTask = match(drawer)
    .with({ kind: "remove_task" }, ({ id: taskId }) => tasks.find((t) => t.id === taskId) ?? null)
    .with(
      { kind: "none" },
      { kind: "add_task" },
      { kind: "edit_task" },
      { kind: "edit_project" },
      { kind: "remove_project" },
      () => null,
    )
    .exhaustive();

  return (
    <Shell>
      <ProjectHeader
        name={project.name}
        description={project.description}
        counts={countTasks(tasks)}
        leading={<BackLink />}
        trailing={
          <ProjectActionsMenu
            projectName={project.name}
            onEdit={() => setDrawer({ kind: "edit_project" })}
            onRemove={() => setDrawer({ kind: "remove_project" })}
          />
        }
      />
      {tasks.length === 0 ? (
        <EmptyState icon={ListChecksIcon} title="No tasks yet" action="to add the first one." />
      ) : (
        <TaskList
          tasks={tasks}
          syncStateOf={(taskId) => syncStateOf(taskId, localStates)}
          handlersFor={handlersFor}
        />
      )}
      <Fab onClick={() => setDrawer({ kind: "add_task" })} label="Add task" />

      <FormDrawer
        open={drawer.kind === "add_task"}
        title="Add a task"
        description="Describe the task, optionally add notes."
        onClose={() => setDrawer(DRAWER_NONE)}
      >
        <AddTaskForm
          onSubmit={(input) => {
            create.mutate({ input, tempId: parseTaskId(localIdSeed()) });
            setDrawer(DRAWER_NONE);
          }}
          onCancel={() => setDrawer(DRAWER_NONE)}
        />
      </FormDrawer>

      <FormDrawer
        open={editingTask !== null}
        title="Edit task"
        description="Change the task or its notes."
        onClose={() => setDrawer(DRAWER_NONE)}
      >
        {editingTask !== null && (
          <EditTaskForm
            initial={editingTask}
            onSubmit={(input) => edit.mutate({ taskId: editingTask.id, input })}
            onCancel={() => setDrawer(DRAWER_NONE)}
          />
        )}
      </FormDrawer>

      <FormDrawer
        open={drawer.kind === "edit_project"}
        title="Edit project"
        description="Rename the project or change its description."
        onClose={() => setDrawer(DRAWER_NONE)}
      >
        <EditProjectForm
          initial={project}
          onSubmit={(input) => editProject.mutate(input)}
          onCancel={() => setDrawer(DRAWER_NONE)}
        />
      </FormDrawer>

      <ConfirmDrawer
        open={removingTask !== null}
        title={`Remove ${removingTask?.title ?? "task"}?`}
        description="This can't be undone — the task will be gone for everyone in the household."
        confirmLabel="Remove"
        onConfirm={() => {
          if (removingTask !== null) removeTask.mutate(removingTask.id);
          setDrawer(DRAWER_NONE);
        }}
        onClose={() => setDrawer(DRAWER_NONE)}
      />

      <ConfirmDrawer
        open={drawer.kind === "remove_project"}
        title={`Delete ${project.name}?`}
        description={deleteProjectWarning(tasks.length)}
        confirmLabel="Delete project"
        onConfirm={() => {
          setDrawer(DRAWER_NONE);
          removeProject.mutate(id);
          void navigate({ to: "/todo" });
        }}
        onClose={() => setDrawer(DRAWER_NONE)}
      />
    </Shell>
  );
};
