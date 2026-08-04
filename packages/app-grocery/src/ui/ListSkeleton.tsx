import type { ReactElement } from "react";

const ROWS = [
  { id: "a", height: 60, bar: "40%", subline: "25%" },
  { id: "b", height: 64, bar: "57%", subline: null },
  { id: "c", height: 58, bar: "74%", subline: "47%" },
  { id: "d", height: 66, bar: "46%", subline: null },
  { id: "e", height: 60, bar: "63%", subline: "34%" },
  { id: "f", height: 64, bar: "80%", subline: null },
  { id: "g", height: 58, bar: "52%", subline: "56%" },
] as const;

export const ListSkeleton = (): ReactElement => (
  <>
    <div className="shrink-0 bg-white px-5 pt-[max(env(safe-area-inset-top),0.5rem)] pb-3">
      <div className="h-7 w-28 animate-pulse rounded-md bg-slate-100" />
      <div className="mt-2 h-3.5 w-20 animate-pulse rounded bg-slate-100" />
    </div>
    <div className="flex-1 divide-y divide-slate-100 bg-white">
      {ROWS.map((row) => (
        <div key={row.id} className="flex items-center gap-3 px-5" style={{ height: row.height }}>
          <div className="size-6 animate-pulse rounded-full bg-slate-100" />
          <div className="flex-1">
            <div className="h-3.5 animate-pulse rounded bg-slate-100" style={{ width: row.bar }} />
            {row.subline !== null && (
              <div
                className="mt-2 h-3 animate-pulse rounded bg-slate-100"
                style={{ width: row.subline }}
              />
            )}
          </div>
          <div className="size-6 animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  </>
);
