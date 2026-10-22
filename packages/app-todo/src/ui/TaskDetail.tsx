import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  PencilSimpleIcon,
  TrashIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type ReactElement, type ReactNode, type Ref, useId } from "react";
import type { DueDate, Task, TodoMember } from "../shared/index.ts";
import { Avatar } from "./Avatar.tsx";
import { cn } from "./cn.ts";
import { DueBadge } from "./DueBadge.tsx";

export type DetailTitleProps = {
  className: string;
  children: ReactNode;
  ref: Ref<HTMLHeadingElement>;
};

type TaskDetailProps = {
  task: Task;
  projectName: string;
  today: DueDate;
  members: readonly TodoMember[];
  titleRef: Ref<HTMLHeadingElement>;
  renderTitle: (props: DetailTitleProps) => ReactElement;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
  onClose: () => void;
};

const shortDate = (ms: number): string =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(ms),
  );

const calendarDate = (due: DueDate): string => {
  const [y = 0, m = 1, d = 1] = due.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
};

const Property = ({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}): ReactElement => (
  <div className="flex min-h-11 items-center gap-3">
    <dt className="flex w-28 shrink-0 items-center gap-2 text-slate-600 text-sm">
      {icon}
      {label}
    </dt>
    <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-slate-900">
      {children}
    </dd>
  </div>
);

const actionClass =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-medium text-base outline-none transition focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 active:scale-[0.98]";

export const TaskDetail = ({
  task,
  projectName,
  today,
  members,
  titleRef,
  renderTitle,
  onToggle,
  onEdit,
  onRemove,
  onClose,
}: TaskDetailProps): ReactElement => {
  const notesHeadingId = useId();
  const { status } = task;
  const done = status.kind === "done";
  const doneBy =
    status.kind === "done" ? (members.find((m) => m.id === status.doneBy) ?? null) : null;
  const hasNotes = task.notes !== null && task.notes.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        <div className="-mr-2 flex items-center gap-2">
          <span className="min-w-0 truncate font-semibold text-[11px] text-slate-600 uppercase tracking-[0.12em]">
            {projectName}
          </span>
          {done && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 text-xs">
              <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
              Done
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto grid size-11 shrink-0 place-items-center rounded-full text-slate-600 outline-none transition focus-visible:ring-2 focus-visible:ring-slate-900 active:bg-slate-100"
          >
            <XIcon size={18} weight="bold" />
          </button>
        </div>

        {renderTitle({
          ref: titleRef,
          className:
            "select-text text-pretty break-words font-semibold text-[22px] text-slate-900 leading-snug tracking-tight outline-none",
          children: task.title,
        })}

        <dl className="mt-4 divide-y divide-slate-100 border-slate-100 border-y">
          <Property icon={<CalendarBlankIcon size={16} aria-hidden="true" />} label="Due">
            {task.dueOn === null ? (
              <span className="text-slate-500">No due date</span>
            ) : (
              <>
                <DueBadge dueOn={task.dueOn} today={today} done={done} />
                <span className="text-slate-600 text-sm">{calendarDate(task.dueOn)}</span>
              </>
            )}
          </Property>
          <Property icon={<UserCircleIcon size={16} aria-hidden="true" />} label="Assigned to">
            {task.assignee === null ? (
              <span className="text-slate-500">Nobody</span>
            ) : (
              <>
                <Avatar author={{ kind: "user", ...task.assignee }} size={24} decorative />
                <span className="truncate">{task.assignee.name}</span>
              </>
            )}
          </Property>
        </dl>

        <section className="mt-5" aria-labelledby={notesHeadingId}>
          <h3
            id={notesHeadingId}
            className="font-semibold text-[11px] text-slate-600 uppercase tracking-[0.12em]"
          >
            Notes
          </h3>
          {hasNotes ? (
            <p className="mt-2 select-text whitespace-pre-wrap break-words text-base text-slate-800 leading-relaxed">
              {task.notes}
            </p>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              className="-mx-2 mt-1 flex min-h-11 items-center rounded-lg px-2 text-base text-slate-600 underline decoration-slate-400 underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              Add notes
            </button>
          )}
        </section>

        <p className="mt-6 text-slate-600 text-sm leading-relaxed">
          Added by {task.addedBy.name} · {shortDate(task.createdAt)}
          {status.kind === "done" && (
            <>
              <br />
              Completed{doneBy === null ? "" : ` by ${doneBy.name}`} · {shortDate(status.doneAt)}
            </>
          )}
        </p>

        <button
          type="button"
          onClick={onRemove}
          className={cn(actionClass, "mt-4 text-rose-700 active:bg-rose-50")}
        >
          <TrashIcon size={20} aria-hidden="true" />
          Delete task
        </button>
      </div>

      <div className="shrink-0 space-y-2.5 border-slate-100 border-t bg-white px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <button
          type="button"
          onClick={() => onToggle(!done)}
          className={cn(
            actionClass,
            done ? "bg-slate-100 text-slate-900" : "bg-emerald-700 text-white",
          )}
        >
          {done ? (
            <>
              <ArrowCounterClockwiseIcon size={20} weight="bold" aria-hidden="true" />
              Reopen task
            </>
          ) : (
            <>
              <CheckCircleIcon size={20} weight="bold" aria-hidden="true" />
              Mark as done
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className={cn(actionClass, "bg-slate-100 text-slate-900")}
        >
          <PencilSimpleIcon size={20} aria-hidden="true" />
          Edit
        </button>
      </div>
    </div>
  );
};
