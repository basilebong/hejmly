import { ArrowsClockwiseIcon, CheckIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import type { ReactElement, ReactNode } from "react";
import type { DueDate, SyncState, Task } from "../shared/index.ts";
import { Avatar } from "./Avatar.tsx";
import { cn } from "./cn.ts";
import { DueBadge } from "./DueBadge.tsx";
import { syncFlags } from "./sync.ts";

export type TaskRowHandlers = {
  onOpen: () => void;
  onToggle: (next: boolean) => void;
  onRetry: () => void;
  onDiscard: () => void;
};

type TaskRowProps = TaskRowHandlers & {
  task: Task;
  today: DueDate;
  syncState: SyncState;
};

const Checkbox = ({
  done,
  title,
  onToggle,
}: {
  done: boolean;
  title: string;
  onToggle: (next: boolean) => void;
}): ReactElement => (
  <button
    type="button"
    onClick={() => onToggle(!done)}
    className="-my-2.5 -ml-2.5 flex size-11 shrink-0 items-center justify-center"
    aria-pressed={done}
    aria-label={done ? `Reopen ${title}` : `Mark ${title} as done`}
  >
    {done ? (
      <span className="grid size-6 place-items-center rounded-full bg-emerald-500">
        <CheckIcon size={13} weight="bold" className="text-white" />
      </span>
    ) : (
      <span className="size-6 rounded-full border-[1.5px] border-slate-300" />
    )}
  </button>
);

export const TaskRow = ({
  task,
  today,
  syncState,
  onOpen,
  onToggle,
  onRetry,
  onDiscard,
}: TaskRowProps): ReactElement => {
  const done = task.status.kind === "done";
  const { queued, failed } = syncFlags(syncState);
  const local = queued || failed;
  const hasNotes = task.notes !== null && task.notes.length > 0;

  const body: ReactNode = (
    <>
      <span
        className={cn(
          "block text-pretty break-words font-medium text-base leading-snug",
          done
            ? "text-slate-400 line-through decoration-slate-300"
            : queued
              ? "text-slate-400 italic"
              : "text-slate-900",
        )}
      >
        {task.title}
      </span>
      {hasNotes && (
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 line-clamp-2 block break-words text-sm leading-snug",
            done ? "text-slate-300" : "text-slate-500",
          )}
        >
          {task.notes}
        </span>
      )}
      {task.dueOn !== null && (
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <DueBadge dueOn={task.dueOn} today={today} done={done} />
        </span>
      )}
    </>
  );

  return (
    <li className="relative flex items-start gap-3 bg-white py-3 pr-3 pl-5">
      <div className="pt-0.5">
        {local ? (
          <span className="flex size-6 items-center justify-center">
            <span className="size-6 rounded-full border-[1.5px] border-slate-200 border-dashed" />
          </span>
        ) : (
          <Checkbox done={done} title={task.title} onToggle={onToggle} />
        )}
      </div>

      {local ? (
        <div className="min-w-0 flex-1">
          {body}
          <span className="mt-1.5 flex items-center gap-3">
            {queued && (
              <span className="inline-flex items-center gap-1 font-semibold text-[10px] text-slate-400 uppercase tracking-wider">
                <ArrowsClockwiseIcon size={11} className="animate-spin" />
                Saving
              </span>
            )}
            {failed && (
              <>
                <button
                  type="button"
                  onClick={onRetry}
                  className="-my-3 inline-flex min-h-11 items-center gap-1 font-semibold text-rose-600 text-xs uppercase tracking-wider"
                >
                  <WarningCircleIcon size={13} weight="fill" />
                  Not saved · Retry
                </button>
                <button
                  type="button"
                  onClick={onDiscard}
                  aria-label={`Discard ${task.title}`}
                  className="-my-3 ml-auto grid size-11 place-items-center rounded-full text-slate-400 transition active:bg-slate-100"
                >
                  <XIcon size={16} weight="bold" />
                </button>
              </>
            )}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          aria-haspopup="dialog"
          className="-my-1 flex min-h-11 min-w-0 flex-1 items-start gap-3 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <span className="min-w-0 flex-1">
            {body}
            <span className="sr-only">
              {task.assignee === null ? "" : `, assigned to ${task.assignee.name}`}. Open details
            </span>
          </span>
          {task.assignee !== null && (
            <span className="shrink-0 pt-0.5">
              <Avatar author={{ kind: "user", ...task.assignee }} size={26} decorative />
            </span>
          )}
        </button>
      )}
    </li>
  );
};
