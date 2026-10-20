import type { ReactElement } from "react";
import { cn } from "./cn.ts";

const PROJECT_ROWS = [
  { id: "a", bar: "45%", sub: "70%" },
  { id: "b", bar: "60%", sub: null },
  { id: "c", bar: "38%", sub: "55%" },
  { id: "d", bar: "52%", sub: null },
] as const;

const TASK_ROWS = [
  { id: "a", bar: "55%", sub: null },
  { id: "b", bar: "70%", sub: "40%" },
  { id: "c", bar: "42%", sub: null },
  { id: "d", bar: "64%", sub: "52%" },
  { id: "e", bar: "48%", sub: null },
] as const;

const Pulse = ({ className, width }: { className: string; width?: string }): ReactElement => (
  <div
    className={cn("animate-pulse rounded bg-slate-100", className)}
    style={width === undefined ? undefined : { width }}
  />
);

export const ProjectsSkeleton = (): ReactElement => (
  <>
    <div className="shrink-0 bg-white px-5 pt-[max(env(safe-area-inset-top),0.5rem)] pb-3">
      <Pulse className="h-7 w-32 rounded-md" />
      <Pulse className="mt-2 h-3.5 w-40" />
    </div>
    <div className="flex-1 divide-y divide-slate-100 bg-white px-5">
      {PROJECT_ROWS.map((row) => (
        <div key={row.id} className="flex min-h-[76px] items-center gap-3.5 py-3.5">
          <Pulse className="size-11 rounded-xl" />
          <div className="flex-1">
            <Pulse className="h-4" width={row.bar} />
            {row.sub !== null && <Pulse className="mt-2 h-3" width={row.sub} />}
            <Pulse className="mt-2.5 h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  </>
);

export const TasksSkeleton = (): ReactElement => (
  <>
    <div className="shrink-0 bg-white pt-[env(safe-area-inset-top)] pb-3">
      <div className="h-12" />
      <div className="px-5">
        <Pulse className="h-6 w-48 rounded-md" />
        <Pulse className="mt-3 h-1.5 w-full rounded-full" />
      </div>
    </div>
    <div className="flex-1 divide-y divide-slate-100 bg-white">
      {TASK_ROWS.map((row) => (
        <div key={row.id} className="flex min-h-[60px] items-center gap-3 px-5 py-3.5">
          <Pulse className="size-6 rounded-md" />
          <div className="flex-1">
            <Pulse className="h-3.5" width={row.bar} />
            {row.sub !== null && <Pulse className="mt-2 h-3" width={row.sub} />}
          </div>
          <Pulse className="size-6 rounded-full" />
        </div>
      ))}
    </div>
  </>
);
