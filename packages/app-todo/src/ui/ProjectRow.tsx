import { CaretRightIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import type { Project, SyncState } from "../shared/index.ts";
import { cn } from "./cn.ts";
import { paletteFor } from "./colors.ts";
import { ProgressBar } from "./ProgressBar.tsx";
import { syncFlags } from "./sync.ts";

type ProjectRowProps = {
  project: Project;
  syncState: SyncState;
  onRetry: () => void;
  onDiscard: () => void;
};

export const ProjectRow = ({
  project,
  syncState,
  onRetry,
  onDiscard,
}: ProjectRowProps): ReactElement => {
  const { queued: saving, failed } = syncFlags(syncState);
  const palette = paletteFor(project.id);
  const { open, done } = project.taskCounts;
  const total = open + done;
  return (
    <div className="flex min-h-[76px] items-center gap-3.5 py-3.5">
      <span
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-xl font-semibold text-base"
        style={{ background: palette.bg, color: palette.fg }}
      >
        {project.name.trim().charAt(0).toUpperCase() || "·"}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate font-medium text-base leading-tight",
              saving || failed ? "text-slate-400 italic" : "text-slate-900",
            )}
          >
            {project.name}
          </span>
          {saving && (
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-[10px] text-slate-400 uppercase tracking-wider">
              <span className="size-1.5 animate-pulse rounded-full bg-slate-400" />
              Saving
            </span>
          )}
          {failed && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-11 shrink-0 items-center gap-1 font-semibold text-[10px] text-rose-600 uppercase tracking-wider"
            >
              <WarningCircleIcon size={11} weight="fill" />
              Retry
            </button>
          )}
        </div>
        {project.description !== null && project.description.length > 0 && (
          <span className="mt-0.5 truncate text-slate-500 text-sm leading-snug">
            {project.description}
          </span>
        )}
        <div className="mt-2 flex items-center gap-2.5">
          {total === 0 ? (
            <span className="text-slate-400 text-xs">No tasks yet</span>
          ) : (
            <>
              <ProgressBar counts={project.taskCounts} label={`${project.name} progress`} />
              <span className="shrink-0 text-slate-500 text-xs tabular-nums">
                {open === 0 ? "All done" : `${open} open`}
              </span>
            </>
          )}
        </div>
      </div>
      {failed ? (
        <button
          type="button"
          onClick={onDiscard}
          aria-label={`Discard ${project.name}`}
          className="grid size-11 shrink-0 place-items-center rounded-full text-slate-400 transition active:bg-slate-100"
        >
          <XIcon size={16} weight="bold" />
        </button>
      ) : (
        <CaretRightIcon size={16} weight="bold" className="shrink-0 text-slate-300" />
      )}
    </div>
  );
};
