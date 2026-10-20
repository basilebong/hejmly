import * as Progress from "@radix-ui/react-progress";
import type { ReactElement } from "react";
import type { TaskCounts } from "../shared/index.ts";

type ProgressBarProps = {
  counts: TaskCounts;
  label: string;
};

export const ProgressBar = ({ counts, label }: ProgressBarProps): ReactElement | null => {
  const total = counts.open + counts.done;
  if (total === 0) return null;
  return (
    <Progress.Root
      value={counts.done}
      max={total}
      aria-label={label}
      getValueLabel={(value, max) => `${value} of ${max} done`}
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <Progress.Indicator
        className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
        style={{ width: `${(counts.done / total) * 100}%` }}
      />
    </Progress.Root>
  );
};
