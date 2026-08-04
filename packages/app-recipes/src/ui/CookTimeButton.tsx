import { TimerIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { match } from "ts-pattern";
import { formatClock, type Timer, viewTimer } from "../shared/index.ts";

type CookTimeButtonProps = {
  id: string;
  minutes: number;
  label: string;
  timer: Timer | undefined;
  now: number;
  accent: string;
  onStart: (id: string, label: string, minutes: number) => void;
  onCancel: (id: string) => void;
};

export const CookTimeButton = ({
  id,
  minutes,
  label,
  timer,
  now,
  accent,
  onStart,
  onCancel,
}: CookTimeButtonProps): ReactElement =>
  match(viewTimer(timer, now))
    .with({ kind: "idle" }, () => (
      <button
        type="button"
        onClick={() => onStart(id, label, minutes)}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl border-[1.5px] font-semibold text-[16px] transition active:scale-[0.99]"
        style={{ borderColor: accent, color: accent }}
      >
        <TimerIcon size={22} />
        Start {minutes}-min timer
      </button>
    ))
    .with({ kind: "running" }, ({ remainingMs, fraction }) => (
      <button
        type="button"
        onClick={() => onCancel(id)}
        aria-label={`Cancel ${label} timer`}
        className="relative flex h-14 w-full items-center justify-between overflow-hidden rounded-2xl px-5 text-white transition active:scale-[0.99]"
        style={{ background: accent }}
      >
        <span
          className="absolute inset-y-0 left-0 bg-black/15"
          style={{ width: `${fraction * 100}%` }}
        />
        <span className="relative inline-flex items-center gap-2 font-semibold">
          <TimerIcon size={20} weight="fill" className="animate-pulse" />
          {label}
        </span>
        <span className="relative font-semibold text-[22px] tabular-nums">
          {formatClock(remainingMs)}
        </span>
      </button>
    ))
    .with({ kind: "done" }, () => (
      <button
        type="button"
        onClick={() => onCancel(id)}
        aria-label={`Dismiss ${label} timer`}
        className="flex h-14 w-full animate-oh-ring items-center justify-between rounded-2xl px-5 text-white transition active:scale-[0.99]"
        style={{ background: accent }}
      >
        <span className="inline-flex items-center gap-2 font-semibold">
          <TimerIcon size={20} weight="fill" />
          {label}
        </span>
        <span className="font-semibold text-[18px]">Time's up</span>
      </button>
    ))
    .exhaustive();
