import type { ReactElement } from "react";

type ProjectsTopBarProps = {
  projectCount: number;
  openTaskCount: number;
};

export const ProjectsTopBar = ({
  projectCount,
  openTaskCount,
}: ProjectsTopBarProps): ReactElement => (
  <header className="shrink-0 bg-white px-5 pt-[max(env(safe-area-inset-top),0.5rem)] pb-3">
    <h1 className="font-semibold text-2xl text-slate-900 tracking-tight">Projects</h1>
    <p className="mt-0.5 text-slate-500 text-sm tabular-nums">
      {projectCount} {projectCount === 1 ? "project" : "projects"} · {openTaskCount} open{" "}
      {openTaskCount === 1 ? "task" : "tasks"}
    </p>
  </header>
);
