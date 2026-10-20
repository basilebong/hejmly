import {
  type CreateProjectInput,
  type Project,
  type ProjectId,
  parseProjectId,
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
import { createProject, fetchProjects } from "@/lib/todo-api";
import { FormDrawer } from "./FormDrawer.tsx";
import { isTempId, PROJECTS_QUERY_KEY, tempIdSeed } from "./keys.ts";
import { useTodoIdentity } from "./useTodoIdentity.ts";

export const ProjectsScreen = (): ReactElement => {
  const qc = useQueryClient();
  const identity = useTodoIdentity();
  const [adding, setAdding] = useState(false);

  const projects = useQuery({
    queryKey: PROJECTS_QUERY_KEY,
    queryFn: fetchProjects,
    refetchInterval: 30_000,
  });

  const create = useMutation({
    mutationFn: ({ input, tempId }: { input: CreateProjectInput; tempId: ProjectId }) =>
      createProject(input, tempId),
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
      qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current) => [optimistic, ...(current ?? [])]);
      return { tempId };
    },
    onError: (_e, _vars, ctx) => {
      if (!navigator.onLine) return;
      if (ctx !== undefined) {
        qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current) =>
          (current ?? []).filter((p) => p.id !== ctx.tempId),
        );
      }
      toast.error("Could not create project");
    },
    onSuccess: (saved, _vars, ctx) => {
      if (ctx === undefined) return;
      qc.setQueryData<Project[]>(PROJECTS_QUERY_KEY, (current) =>
        (current ?? []).map((p) => (p.id === ctx.tempId ? saved : p)),
      );
    },
  });

  const handleCreate = (input: CreateProjectInput): void => {
    create.mutate({ input, tempId: parseProjectId(tempIdSeed()) });
    setAdding(false);
  };

  if (projects.isPending) {
    return (
      <main className="flex h-dvh flex-col overflow-hidden bg-slate-50">
        <ProjectsSkeleton />
        <BottomNav active="todo" />
      </main>
    );
  }

  if (projects.isError) {
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
          {list.map((project) => (
            <li key={project.id}>
              {isTempId(project.id) ? (
                <ProjectRow project={project} saving />
              ) : (
                <Link
                  to="/todo/$projectId"
                  params={{ projectId: project.id }}
                  className="-mx-2 block rounded-xl px-2 transition active:bg-slate-50"
                >
                  <ProjectRow project={project} />
                </Link>
              )}
            </li>
          ))}
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
