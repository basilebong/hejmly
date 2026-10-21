import {
  type CreateProjectInput,
  isLocalId,
  localIdSeed,
  type Project,
  type ProjectId,
  parseProjectId,
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ReactElement, useState } from "react";

import { BottomNav } from "@/components/BottomNav";
import { createProjectMutation, projectsQuery } from "./cache.ts";
import { useTodoCacheEnv } from "./env.ts";
import { FormDrawer } from "./FormDrawer.tsx";
import { CREATE_PROJECT_KEY, PROJECTS_QUERY_KEY } from "./keys.ts";
import { useLocalRowStates } from "./mutation-state.ts";

export const ProjectsScreen = (): ReactElement => {
  const env = useTodoCacheEnv();
  const [adding, setAdding] = useState(false);
  const localStates = useLocalRowStates(CREATE_PROJECT_KEY);
  const projects = useQuery(projectsQuery(env));
  const create = useMutation(createProjectMutation(env));

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
    env.qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current = []) =>
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
