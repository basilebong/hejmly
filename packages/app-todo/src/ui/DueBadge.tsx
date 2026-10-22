import { CalendarBlankIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { match } from "ts-pattern";
import { type DueDate, dueLabel, dueState } from "../shared/index.ts";
import { cn } from "./cn.ts";

type Tone = "overdue" | "today" | "soon" | "muted";

const toneClass: Record<Tone, string> = {
  overdue: "bg-rose-50 text-rose-700 ring-rose-200",
  today: "bg-amber-50 text-amber-800 ring-amber-200",
  soon: "bg-slate-50 text-slate-600 ring-slate-200",
  muted: "bg-transparent text-slate-500 ring-slate-300",
};

type DueBadgeProps = {
  dueOn: DueDate;
  today: DueDate;
  done: boolean;
};

export const DueBadge = ({ dueOn, today, done }: DueBadgeProps): ReactElement => {
  const state = dueState(dueOn, today);
  const label = dueLabel(dueOn, today);
  const tone: Tone = done
    ? "muted"
    : match(state)
        .with({ kind: "overdue" }, (): Tone => "overdue")
        .with({ kind: "today" }, (): Tone => "today")
        .with({ kind: "tomorrow" }, { kind: "upcoming" }, (): Tone => "soon")
        .exhaustive();
  const overdue = tone === "overdue";
  const Icon = overdue ? WarningCircleIcon : CalendarBlankIcon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs ring-1 ring-inset",
        toneClass[tone],
      )}
    >
      <Icon size={12} weight={overdue ? "fill" : "bold"} aria-hidden="true" />
      <span>
        <span className="sr-only">{overdue ? "Overdue, was due " : "Due "}</span>
        {overdue ? <span aria-hidden="true">Overdue · </span> : null}
        {label}
      </span>
    </span>
  );
};
