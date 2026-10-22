import type { ReactElement, ReactNode } from "react";

type SectionLabelProps = {
  children: ReactNode;
  right?: ReactNode;
  id?: string;
};

export const SectionLabel = ({ children, right, id }: SectionLabelProps): ReactElement => (
  <div className="flex items-baseline justify-between bg-slate-50 px-5 pt-6 pb-2">
    <h2 id={id} className="font-semibold text-[11px] text-slate-500 uppercase tracking-[0.12em]">
      {children}
    </h2>
    {right}
  </div>
);
