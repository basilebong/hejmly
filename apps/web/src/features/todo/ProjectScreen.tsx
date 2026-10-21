import {
  type CreateTaskInput,
  countTasks,
  isLocalId,
  localIdSeed,
  type ProjectId,
  ProjectIdSchema,
  type ProjectWithTasks,
  parseTaskId,
  syncStateOf,
  type TaskId,
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactElement, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import * as v from "valibot";

import { BottomNav } from "@/components/BottomNav";
import { ConfirmDrawer } from "./ConfirmDrawer.tsx";
import { isMissing, projectDetailQuery, projectMutations, removeProjectMutation } from "./cache.ts";
import { useTodoCacheEnv } from "./env.ts";
import { FormDrawer } from "./FormDrawer.tsx";
import { createTaskKey, projectQueryKey } from "./keys.ts";
import { useLocalRowStates } from "./mutation-state.ts";

type DrawerState =
  | { kind: "none" }
  | { kind: "add_task" }
  | { kind: "edit_task"; id: TaskId }
  | { kind: "remove_task"; id: TaskId }
  | { kind: "edit_project" }
  | { kind: "remove_project" };

const DRAWER_NONE: DrawerState = { kind: "none" };

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
  const env = useTodoCacheEnv();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState<DrawerState>(DRAWER_NONE);
  const localStates = useLocalRowStates(createTaskKey(id));

  const detail = useQuery(projectDetailQuery(env, id));
  const mutations = projectMutations(env, id, () => setDrawer(DRAWER_NONE));
  const create = useMutation(mutations.createTask);
  const toggle = useMutation(mutations.toggleTask);
  const edit = useMutation(mutations.editTask);
  const removeTask = useMutation(mutations.removeTask);
  const editProject = useMutation(mutations.editProject);
  const removeProject = useMutation(removeProjectMutation(env));

  const discardLocalTask = (taskId: TaskId): void => {
    env.qc.setQueryData<ProjectWithTasks>(projectQueryKey(id), (current) =>
      current === undefined
        ? current
        : { ...current, tasks: current.tasks.filter((t) => t.id !== taskId) },
    );
  };

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
      if (isLocalId(taskId)) discardLocalTask(taskId);
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
