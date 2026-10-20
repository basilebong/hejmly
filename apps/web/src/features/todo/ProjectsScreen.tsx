import {
  type CreateProjectInput,
  isLocalId,
  localIdSeed,
  mergeServerRows,
  type Project,
  type ProjectId,
  ProjectIdSchema,
  parseProjectId,
  settleLocalRow,
  syncStateOf,
} from "@hejmly/app-todo/shared";
import {
  AddProjectForm,
  EmptyState,
  Fab,
  ProjectRow,
  ProjectsSkeleton,
  ProjectsTopBar,
} from "@hejmly/app-todo/ui";
import { CheckSquareIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/BottomNav";
import { useSessionAuthor } from "@/lib/session-author";
import { createProject, fetchProjects } from "@/lib/todo-api";
import { FormDrawer } from "./FormDrawer.tsx";
import { CREATE_PROJECT_KEY, DELETE_PROJECT_KEY, PROJECTS_QUERY_KEY } from "./keys.ts";
import { pendingIds, useLocalRowStates } from "./mutation-state.ts";

type CreateVariables = { input: CreateProjectInput; tempId: ProjectId };

export const ProjectsScreen = (): ReactElement => {
  const qc = useQueryClient();
  const identity = useSessionAuthor();
  const [adding, setAdding] = useState(false);
  const localStates = useLocalRowStates(CREATE_PROJECT_KEY);

  const projects = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: async () =>
      mergeServerRows(await fetchProjects(), qc.getQueryData<Project[]>(PROJECTS_QUERY_KEY), {
        localAt: "start",
        hidden: pendingIds(qc, DELETE_PROJECT_KEY, ProjectIdSchema),
      }),
    refetchInterval: 30_000,
  });

  const create = useMutation({
    mutationKey: CREATE_PROJECT_KEY,
    mutationFn: ({ input, tempId }: CreateVariables) => createProject(input, tempId),
    onMutate: async ({ input, tempId }) => {
      await qc.cancelQueries({ queryKey: PROJECTS_QUERY_KEY });
      const now = Date.now();
      const optimistic: Project = {
        id: tempId,
        name: input.name,
        description: input.description ?? null,
        createdAt: now,
        updatedAt: now,
        createdBy: identity,
        taskCounts: { open: 0, done: 0 },
      };
      qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current = []) =>
        current.some((p) => p.id === tempId)
          ? current.map((p) => (p.id === tempId ? optimistic : p))
          : [optimistic, ...current],
      );
    },
    onError: () => {
      if (!navigator.onLine) return;
      toast.error("Could not create project — tap retry");
    },
    onSuccess: (saved, { tempId }) => {
      qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current = []) =>
        settleLocalRow(current, tempId, saved, "start"),
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PROJECTS_QUERY_KEY }),
  });

  const handleCreate = (input: CreateProjectInput): void => {
    create.mutate({ input, tempId: parseProjectId(localIdSeed()) });
    setAdding(false);
  };

  const handleRetry = (project: Project): void => {
    const input: CreateProjectInput =
      project.description === null
        ? { name: project.name }
        : { name: project.name, description: project.description };
    create.mutate({ input, tempId: project.id });
  };

  const handleDiscard = (id: ProjectId): void => {
    qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current = []) =>
      current.filter((p) => p.id !== id),
    );
  };

  if (projects.isPending) {
    return (
      <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
        <ProjectsSkeleton />
        <BottomNav active="todo" />
      </main>
    );
  }

  if (projects.data === undefined) {
    return (
      <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <WarningCircleIcon size={40} weight="fill" className="text-slate-300" />
          <div>
            <p className="font-medium text-base text-slate-900">Couldn't load your projects</p>
            <p className="mt-1 text-slate-500 text-sm">Check your connection and try again.</p>
          </div>
          <button
            type="button"
            onClick={() => void projects.refetch()}
            className="flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-6 font-medium text-base text-white transition active:scale-[0.98]"
          >
            Try again
          </button>
        </div>
        <BottomNav active="todo" />
      </main>
    );
  }

  const list = projects.data;
  const openTasks = list.reduce((sum, p) => sum + p.taskCounts.open, 0);

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
      <ProjectsTopBar projectCount={list.length} openTaskCount={openTasks} />
      {list.length === 0 ? (
        <EmptyState icon={CheckSquareIcon} title="No projects yet" action="to start one." />
      ) : (
        <ul
          aria-label="Projects"
          className="flex-1 divide-y divide-slate-100 overflow-y-auto bg-white px-5 pb-24"
        >
          {list.map((project) => {
            const row = (
              <ProjectRow
                project={project}
                syncState={syncStateOf(project.id, localStates)}
                onRetry={() => handleRetry(project)}
                onDiscard={() => handleDiscard(project.id)}
              />
            );
            return (
              <li key={project.id}>
                {isLocalId(project.id) ? (
                  row
                ) : (
                  <Link
                    to="/todo/$projectId"
                    params={{ projectId: project.id }}
                    className="-mx-2 block rounded-xl px-2 transition active:bg-slate-50"
                  >
                    {row}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Fab onClick={() => setAdding(true)} label="New project" />
      <BottomNav active="todo" />

      <FormDrawer
        open={adding}
        title="Create a project"
        description="Name the project, optionally add a description."
        onClose={() => setAdding(false)}
      >
        <AddProjectForm onSubmit={handleCreate} onCancel={() => setAdding(false)} />
      </FormDrawer>
    </main>
  );
};
