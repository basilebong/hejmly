import { PlusIcon } from "@phosphor-icons/react";
import type { MouseEvent, ReactElement } from "react";

type FabProps = {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  label: string;
};

export const Fab = ({ onClick, label }: FabProps): ReactElement => (
  <button
    type="button"
    onClick={onClick}
    className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+6rem)] flex size-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg shadow-slate-900/25 transition active:scale-95"
    aria-label={label}
  >
    <PlusIcon size={22} weight="bold" />
  </button>
);
