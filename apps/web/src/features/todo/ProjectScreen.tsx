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
  TaskDetail,
  TaskList,
  type TaskRowHandlers,
  TasksSkeleton,
} from "@hejmly/app-todo/ui";
import { ArrowLeftIcon, ListChecksIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import * as v from "valibot";

import { BottomNav } from "@/components/BottomNav";
import { ConfirmDrawer } from "./ConfirmDrawer.tsx";
import {
  isMissing,
  membersQuery,
  projectDetailQuery,
  projectMutations,
  removeProjectMutation,
} from "./cache.ts";
import { DetailDrawer } from "./DetailDrawer.tsx";
import { useTodoCacheEnv } from "./env.ts";
import { FormDrawer } from "./FormDrawer.tsx";
import { createTaskKey, projectQueryKey } from "./keys.ts";
import { useLocalRowStates } from "./mutation-state.ts";
import { useToday } from "./use-today.ts";

type DrawerState =
  | { kind: "none" }
  | { kind: "add_task" }
  | { kind: "task"; id: TaskId }
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
  const membersResult = useQuery(membersQuery(env));
  const members = membersResult.data ?? [];
  const me = env.author();
  const meId = me.kind === "user" ? me.id : null;
  const today = useToday();
  const opener = useRef<HTMLElement | null>(null);
  const drawerNow = useRef(drawer);
  drawerNow.current = drawer;
  const restoreFocus = (): void => {
    if (drawerNow.current.kind !== "none") return;
    if (opener.current?.isConnected) opener.current.focus();
  };
  const backToTask = (current: DrawerState): DrawerState =>
    current.kind === "edit_task" ? { kind: "task", id: current.id } : DRAWER_NONE;
  const mutations = projectMutations(env, id, () => setDrawer(backToTask));
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
    if (membersResult.isError) toast.error("Couldn't load household members");
  }, [membersResult.isError]);

  useEffect(() => {
    if (drawer.kind !== "task" && drawer.kind !== "edit_task" && drawer.kind !== "remove_task") {
      return;
    }
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
    onOpen: (trigger) => {
      if (isLocalId(taskId)) return;
      opener.current = trigger;
      setDrawer({ kind: "task", id: taskId });
    },
    onToggle: (done: boolean) => {
      if (!isLocalId(taskId)) toggle.mutate({ taskId, done });
    },
    onRetry: () => {
      const task = tasks.find((t) => t.id === taskId);
      if (task === undefined || !isLocalId(taskId)) return;
      const input: CreateTaskInput = {
        title: task.title,
        ...(task.notes === null ? {} : { notes: task.notes }),
        ...(task.dueOn === null ? {} : { dueOn: task.dueOn }),
        ...(task.assignee === null ? {} : { assigneeId: task.assignee.id }),
      };
      create.mutate({ input, tempId: taskId });
    },
    onDiscard: () => {
      if (isLocalId(taskId)) discardLocalTask(taskId);
    },
  });

  const taskIn = (kind: "task" | "edit_task" | "remove_task") =>
    match(drawer)
      .with({ kind: "task" }, { kind: "edit_task" }, { kind: "remove_task" }, (d) =>
        d.kind === kind ? (tasks.find((t) => t.id === d.id) ?? null) : null,
      )
      .with(
        { kind: "none" },
        { kind: "add_task" },
        { kind: "edit_project" },
        { kind: "remove_project" },
        () => null,
      )
      .exhaustive();
  const viewingTask = taskIn("task");
  const editingTask = taskIn("edit_task");
  const removingTask = taskIn("remove_task");

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
          today={today}
          syncStateOf={(taskId) => syncStateOf(taskId, localStates)}
          handlersFor={handlersFor}
        />
      )}
      <Fab
        onClick={(e) => {
          opener.current = e.currentTarget;
          setDrawer({ kind: "add_task" });
        }}
        label="Add task"
      />

      <FormDrawer
        open={drawer.kind === "add_task"}
        title="Add task"
        description="Due date, assignee and notes are optional."
        onClose={() => setDrawer(DRAWER_NONE)}
        onClosed={restoreFocus}
      >
        <AddTaskForm
          members={members}
          meId={meId}
          today={today}
          onSubmit={(input) => {
            create.mutate({ input, tempId: parseTaskId(localIdSeed()) });
            setDrawer(DRAWER_NONE);
          }}
          onCancel={() => setDrawer(DRAWER_NONE)}
        />
      </FormDrawer>

      <DetailDrawer
        open={viewingTask !== null}
        description="Task details"
        onClose={() => setDrawer(DRAWER_NONE)}
        onClosed={restoreFocus}
      >
        {(title) =>
          viewingTask !== null && (
            <TaskDetail
              task={viewingTask}
              projectName={project.name}
              today={today}
              members={members}
              titleRef={title.ref}
              renderTitle={title.render}
              onToggle={(done) => toggle.mutate({ taskId: viewingTask.id, done })}
              onEdit={() => setDrawer({ kind: "edit_task", id: viewingTask.id })}
              onRemove={() => setDrawer({ kind: "remove_task", id: viewingTask.id })}
              onClose={() => setDrawer(DRAWER_NONE)}
            />
          )
        }
      </DetailDrawer>

      <FormDrawer
        open={editingTask !== null}
        title="Edit task"
        description="Change the title, due date, assignee or notes."
        onClose={() => setDrawer(backToTask)}
      >
        {editingTask !== null && (
          <EditTaskForm
            key={editingTask.id}
            initial={editingTask}
            members={members}
            meId={meId}
            today={today}
            onSubmit={(input) => edit.mutate({ taskId: editingTask.id, input })}
            onCancel={() => setDrawer(backToTask)}
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
        title="Delete this task?"
        description={`“${removingTask?.title ?? ""}” will be deleted for everyone in the household. This can't be undone.`}
        confirmLabel="Delete task"
        onConfirm={() => {
          if (removingTask !== null) removeTask.mutate(removingTask.id);
          setDrawer(DRAWER_NONE);
        }}
        onClose={() =>
          setDrawer(removingTask === null ? DRAWER_NONE : { kind: "task", id: removingTask.id })
        }
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
