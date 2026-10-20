import type { ReactElement, ReactNode } from "react";
import type { TaskCounts } from "../shared/index.ts";
import { ProgressBar } from "./ProgressBar.tsx";

type ProjectHeaderProps = {
  name: string;
  description: string | null;
  counts: TaskCounts;
  leading: ReactNode;
  trailing: ReactNode;
};

export const ProjectHeader = ({
  name,
  description,
  counts,
  leading,
  trailing,
}: ProjectHeaderProps): ReactElement => {
  const total = counts.open + counts.done;
  return (
    <header className="shrink-0 bg-white pt-[env(safe-area-inset-top)] pb-3">
      <div className="flex h-12 items-center justify-between px-2">
        {leading}
        {trailing}
      </div>
      <div className="px-5">
        <h1 className="font-semibold text-[22px] text-slate-900 leading-tight tracking-tight">
          {name}
        </h1>
        {description !== null && description.length > 0 && (
          <p className="mt-1 text-pretty text-[14px] text-slate-500 leading-relaxed">
            {description}
          </p>
        )}
        {total > 0 && (
          <div className="mt-3 flex items-center gap-2.5">
            <ProgressBar counts={counts} label={`${name} progress`} />
            <span className="shrink-0 text-slate-500 text-xs tabular-nums">
              {counts.done} of {total} done
            </span>
          </div>
        )}
      </div>
    </header>
  );
};
