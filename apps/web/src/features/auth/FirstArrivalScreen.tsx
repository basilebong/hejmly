import { ArrowRightIcon } from "@phosphor-icons/react";
import { useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

import { Wordmark } from "./atoms/Wordmark";

type Member = {
  initial: string;
  name: string;
  gradient: string;
};

const family: readonly Member[] = [
  { initial: "A", name: "Anna", gradient: "from-amber-300 to-rose-400" },
  { initial: "M", name: "Marcus", gradient: "from-sky-300 to-indigo-400" },
  { initial: "L", name: "Lina", gradient: "from-emerald-300 to-teal-400" },
  { initial: "T", name: "Theo", gradient: "from-violet-300 to-fuchsia-400" },
] as const;

const formatList = (names: readonly string[]): string => {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  const head = names.slice(0, -1).join(", ");
  return `${head} and ${names[names.length - 1] ?? ""}`;
};

export const FirstArrivalScreen = (): React.ReactElement => {
  const router = useRouter();
  const handleContinue = (): void => {
    router.navigate({ to: "/" });
  };

  return (
    <main className="flex min-h-dvh flex-col bg-slate-50 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex flex-1 flex-col px-6 pt-16 pb-10">
        <div className="flex flex-col items-start">
          <Wordmark />
        </div>

        <div className="mt-12">
          <div className="flex -space-x-2">
            {family.map((member) => (
              <div
                key={member.initial}
                className={cn(
                  "grid size-12 place-items-center rounded-full bg-gradient-to-br font-semibold text-[14px] text-white ring-[3px] ring-slate-50",
                  member.gradient,
                )}
              >
                {member.initial}
              </div>
            ))}
          </div>
          <h2 className="mt-5 font-semibold text-[22px] text-slate-900 leading-tight tracking-tight">
            You're in.
            <br />
            The Lindberg house has {family.length} people.
          </h2>
          <p className="mt-3 text-[15px] text-slate-500 leading-relaxed">
            {formatList(family.map((m) => m.name))} are already here. Whatever you add, everyone
            sees.
          </p>
        </div>

        <div className="flex-1" />

        <Button
          onClick={handleContinue}
          className="min-h-12 w-full gap-2 rounded-2xl bg-slate-900 font-medium text-base text-white hover:bg-slate-900/95"
        >
          Go to the list
          <ArrowRightIcon size={16} weight="bold" />
        </Button>
      </div>
    </main>
  );
};
