import { XIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { addDays, type DueDate } from "../shared/index.ts";
import { cn } from "./cn.ts";

type DuePickerProps = {
  id: string;
  value: string;
  today: DueDate;
  onChange: (next: string) => void;
};

const chipClass =
  "flex min-h-11 items-center rounded-full border-[1.5px] px-4 text-[15px] outline-none transition focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2";

export const DuePicker = ({ id, value, today, onChange }: DuePickerProps): ReactElement => {
  const shortcuts: { label: string; date: DueDate }[] = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "In a week", date: addDays(today, 7) },
  ];
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {shortcuts.map((s) => {
          const selected = value === s.date;
          return (
            <button
              key={s.label}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(selected ? "" : s.date)}
              className={cn(
                chipClass,
                selected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700",
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="date"
          inputMode="none"
          autoComplete="off"
          autoCapitalize="off"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          className={cn(
            "flex min-h-12 w-full min-w-0 flex-1 items-center rounded-xl border-[1.5px] border-slate-200 bg-white px-4 text-base outline-none transition-colors focus:border-slate-900",
            value === "" ? "text-slate-400" : "text-slate-900",
          )}
        />
        {value !== "" && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Remove due date"
            className="grid size-12 shrink-0 place-items-center rounded-xl text-slate-500 transition active:bg-slate-100"
          >
            <XIcon size={18} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
};
