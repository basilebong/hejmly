import { ArrowsClockwiseIcon, CheckIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import type { Task } from "../shared/index.ts";
import { Avatar } from "./Avatar.tsx";
import { cn } from "./cn.ts";
import { TaskActionsMenu } from "./TaskActionsMenu.tsx";

export type TaskSyncState = "synced" | "queued" | "error";

export type TaskRowHandlers = {
  onToggle: (next: boolean) => void;
  onRetry: () => void;
  onEdit: () => void;
  onRemove: () => void;
};

type TaskRowProps = TaskRowHandlers & {
  task: Task;
  syncState: TaskSyncState;
};

export const TaskRow = ({
  task,
  syncState,
  onToggle,
  onRetry,
  onEdit,
  onRemove,
}: TaskRowProps): ReactElement => {
  const done = task.status.kind === "done";
  const queued = syncState === "queued";
  const error = syncState === "error";

  const titleClass = done
    ? "text-slate-400 line-through decoration-slate-300"
    : queued
      ? "italic text-slate-400"
      : "text-slate-900";

  const notesClass = done
    ? "text-slate-300 line-through decoration-slate-200"
    : queued
      ? "italic text-slate-400"
      : "text-slate-500";

  return (
    <li className="relative flex min-h-[60px] items-center gap-3 bg-white py-3.5 pr-2 pl-5">
      <button
        type="button"
        onClick={() => onToggle(!done)}
        className="-m-2.5 flex size-11 shrink-0 items-center justify-center"
        aria-pressed={done}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} as done`}
      >
        {done ? (
          <span className="grid size-6 place-items-center rounded-md bg-emerald-500">
            <CheckIcon size={13} weight="bold" className="text-white" />
          </span>
        ) : (
          <span className="size-6 rounded-md border-[1.5px] border-slate-300" />
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className={cn("line-clamp-2 font-medium text-base leading-tight", titleClass)}>
            {task.title}
          </span>
          {queued && (
            <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-[10px] text-slate-400 uppercase not-italic tracking-wider">
              <span className="size-1.5 animate-pulse rounded-full bg-slate-400" />
              Saving
            </span>
          )}
          {error && (
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
        {task.notes !== null && task.notes.length > 0 && (
          <div className={cn("mt-0.5 line-clamp-2 text-sm leading-snug", notesClass)}>
            {task.notes}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!queued && !error && <Avatar author={task.addedBy} />}
        {queued && <ArrowsClockwiseIcon size={16} className="animate-spin text-slate-300" />}
        {!queued && !error && (
          <TaskActionsMenu
            taskTitle={task.title}
            done={done}
            onToggle={() => onToggle(!done)}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        )}
      </div>
    </li>
  );
};
