import {
  ArrowCounterClockwiseIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  PencilSimpleIcon,
  TrashIcon,
  UserCircleIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import type { ReactElement, ReactNode } from "react";
import type { DueDate, Task, TodoMember } from "../shared/index.ts";
import { Avatar } from "./Avatar.tsx";
import { DueBadge } from "./DueBadge.tsx";

type TaskDetailProps = {
  task: Task;
  projectName: string;
  today: DueDate;
  members: readonly TodoMember[];
  renderTitle: (props: { className: string; children: ReactNode }) => ReactElement;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
};

const shortDate = (ms: number): string =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(ms),
  );

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
    <dt className="flex w-28 shrink-0 items-center gap-2 text-slate-500 text-sm">
      {icon}
      {label}
    </dt>
    <dd className="flex min-w-0 flex-1 items-center gap-2 text-[15px] text-slate-900">
      {children}
    </dd>
  </div>
);

const Person = ({ member }: { member: TodoMember }): ReactElement => (
  <>
    <Avatar author={{ kind: "user", ...member }} size={24} decorative />
    <span className="truncate">{member.name}</span>
  </>
);

export const TaskDetail = ({
  task,
  projectName,
  today,
  members,
  renderTitle,
  onToggle,
  onEdit,
  onRemove,
}: TaskDetailProps): ReactElement => {
  const { status } = task;
  const done = status.kind === "done";
  const doneBy =
    status.kind === "done" ? (members.find((m) => m.id === status.doneBy) ?? null) : null;
  const hasNotes = task.notes !== null && task.notes.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-[11px] text-slate-500 uppercase tracking-[0.12em]">
            {projectName}
          </span>
          {done && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 text-xs">
              <CheckCircleIcon size={12} weight="fill" aria-hidden="true" />
              Done
            </span>
          )}
        </div>

        {renderTitle({
          className:
            "mt-1.5 select-text break-words text-pretty font-semibold text-[22px] text-slate-900 leading-snug tracking-tight",
          children: task.title,
        })}

        <dl className="mt-4 divide-y divide-slate-100 border-slate-100 border-y">
          <Property icon={<CalendarBlankIcon size={16} aria-hidden="true" />} label="Due">
            {task.dueOn === null ? (
              <span className="text-slate-400">No due date</span>
            ) : (
              <DueBadge dueOn={task.dueOn} today={today} done={done} />
            )}
          </Property>
          <Property icon={<UserCircleIcon size={16} aria-hidden="true" />} label="Assigned to">
            {task.assignee === null ? (
              <span className="text-slate-400">Nobody</span>
            ) : (
              <Person member={task.assignee} />
            )}
          </Property>
          <Property icon={<UserPlusIcon size={16} aria-hidden="true" />} label="Added">
            <span className="truncate">
              {task.addedBy.name}
              <span className="text-slate-400"> · {shortDate(task.createdAt)}</span>
            </span>
          </Property>
          {status.kind === "done" && (
            <Property icon={<CheckCircleIcon size={16} aria-hidden="true" />} label="Completed">
              <span className="truncate">
                {doneBy === null ? "" : `${doneBy.name} · `}
                <span className={doneBy === null ? "" : "text-slate-400"}>
                  {shortDate(status.doneAt)}
                </span>
              </span>
            </Property>
          )}
        </dl>

        <section className="mt-5" aria-label="Notes">
          <h3 className="font-semibold text-[11px] text-slate-500 uppercase tracking-[0.12em]">
            Notes
          </h3>
          {hasNotes ? (
            <p className="mt-2 select-text whitespace-pre-wrap break-words text-base text-slate-700 leading-relaxed">
              {task.notes}
            </p>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              className="-mx-2 mt-1 flex min-h-11 items-center rounded-lg px-2 text-base text-slate-400"
            >
              Add notes…
            </button>
          )}
        </section>
      </div>

      <div className="shrink-0 space-y-2.5 border-slate-100 border-t bg-white px-5 pt-3 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <button
          type="button"
          onClick={() => onToggle(!done)}
          className={
            done
              ? "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 font-medium text-base text-slate-900 transition active:scale-[0.98]"
              : "flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 font-medium text-base text-white transition active:scale-[0.98]"
          }
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
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 font-medium text-base text-slate-900 transition active:scale-[0.98]"
        >
          <PencilSimpleIcon size={20} aria-hidden="true" />
          Edit
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl font-medium text-base text-rose-600 transition active:bg-rose-50"
        >
          <TrashIcon size={20} aria-hidden="true" />
          Delete task
        </button>
      </div>
    </div>
  );
};
