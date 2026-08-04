import { SignOutIcon } from "@phosphor-icons/react";
import type { ReactElement } from "react";
import { Spinner } from "@/features/auth/atoms/Spinner";

type SignOutButtonProps = {
  loading: boolean;
  onClick: () => void;
};

export const SignOutButton = ({ loading, onClick }: SignOutButtonProps): ReactElement => {
  if (loading) {
    return (
      <button
        type="button"
        disabled
        className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-2xl border border-rose-100 bg-rose-50 font-medium text-base text-rose-700"
      >
        <Spinner size={16} />
        Signing out…
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white font-medium text-base text-rose-600 transition active:bg-rose-50"
    >
      <SignOutIcon size={18} weight="bold" />
      Sign out
    </button>
  );
};
