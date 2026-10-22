import { ArrowsClockwiseIcon, CheckIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import * as Checkbox from "@radix-ui/react-checkbox";
import type { ReactElement, ReactNode } from "react";
import type { DueDate, SyncState, Task, TodoMember } from "../shared/index.ts";
import { Avatar } from "./Avatar.tsx";
import { cn } from "./cn.ts";
import { DueBadge } from "./DueBadge.tsx";
import { syncFlags } from "./sync.ts";

export type TaskRowHandlers = {
  onOpen: (opener: HTMLElement) => void;
  onToggle: (next: boolean) => void;
  onRetry: () => void;
  onDiscard: () => void;
};

type TaskRowProps = TaskRowHandlers & {
  task: Task;
  today: DueDate;
  syncState: SyncState;
};

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

const AssigneeChip = ({ member, done }: { member: TodoMember; done: boolean }): ReactElement => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 font-medium text-xs",
      done ? "text-slate-500" : "text-slate-700",
    )}
  >
    <Avatar author={{ kind: "user", ...member }} size={20} decorative />
    <span className="sr-only">Assigned to </span>
    {firstName(member.name)}
  </span>
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
  const showNotes = !done && task.notes !== null && task.notes.length > 0;
  const showMeta = task.dueOn !== null || task.assignee !== null;

  const body: ReactNode = (
    <>
      <span
        className={cn(
          "block text-pretty break-words font-medium text-base leading-snug",
          done
            ? "text-slate-500 line-through decoration-slate-400"
            : queued
              ? "text-slate-500 italic"
              : "text-slate-900",
        )}
      >
        {task.title}
      </span>
      {showNotes && (
        <span
          aria-hidden="true"
          className="mt-0.5 line-clamp-2 break-words text-slate-500 text-sm leading-snug"
        >
          {task.notes}
        </span>
      )}
      {showMeta && (
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.dueOn !== null && <DueBadge dueOn={task.dueOn} today={today} done={done} />}
          {task.assignee !== null && <AssigneeChip member={task.assignee} done={done} />}
        </span>
      )}
    </>
  );

  return (
    <li className="relative flex items-start gap-3 bg-white py-3 pr-4 pl-5">
      <div className="pt-0.5">
        {local ? (
          <span className="flex size-6 items-center justify-center">
            <span className="size-6 rounded-full border-[1.5px] border-slate-400 border-dashed" />
          </span>
        ) : (
          <Checkbox.Root
            checked={done}
            onCheckedChange={(next) => onToggle(next === true)}
            aria-label={task.title}
            className="group -my-2.5 -ml-2.5 flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          >
            <span className="grid size-6 place-items-center rounded-full border-[1.5px] border-slate-500 group-data-[state=checked]:border-emerald-600 group-data-[state=checked]:bg-emerald-600">
              <Checkbox.Indicator>
                <CheckIcon size={13} weight="bold" className="text-white" />
              </Checkbox.Indicator>
            </span>
          </Checkbox.Root>
        )}
      </div>

      {local ? (
        <div className="min-w-0 flex-1">
          {body}
          <span className="mt-1.5 flex items-center gap-3">
            {queued && (
              <span className="inline-flex items-center gap-1 font-semibold text-slate-500 text-xs uppercase tracking-wider">
                <ArrowsClockwiseIcon size={12} className="animate-spin" />
                Saving
              </span>
            )}
            {failed && (
              <>
                <button
                  type="button"
                  onClick={onRetry}
                  className="-my-3 inline-flex min-h-11 items-center gap-1 font-semibold text-rose-700 text-xs uppercase tracking-wider"
                >
                  <WarningCircleIcon size={13} weight="fill" />
                  Not saved · Retry
                </button>
                <button
                  type="button"
                  onClick={onDiscard}
                  aria-label={`Discard ${task.title}`}
                  className="-my-3 ml-auto grid size-11 place-items-center rounded-full text-slate-500 transition active:bg-slate-100"
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
          onClick={(e) => onOpen(e.currentTarget)}
          aria-haspopup="dialog"
          className="-my-1 flex min-h-11 min-w-0 flex-1 rounded-lg py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
        >
          <span className="min-w-0 flex-1">
            {body}
            <span className="sr-only">. Open details</span>
          </span>
        </button>
      )}
    </li>
  );
};
