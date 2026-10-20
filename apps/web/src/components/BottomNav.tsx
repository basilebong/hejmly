import { TimerBar } from "@hejmly/app-recipes/ui";
import {
  BasketIcon,
  CheckSquareIcon,
  CookingPotIcon,
  type Icon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { cn } from "@/lib/cn";

export type NavTab = "grocery" | "recipes" | "todo" | "apps";

type NavEntry = {
  id: NavTab;
  to: "/grocery" | "/recipes" | "/todo" | "/apps";
  icon: Icon;
  label: string;
};

const ENTRIES: readonly NavEntry[] = [
  { id: "grocery", to: "/grocery", icon: BasketIcon, label: "Grocery" },
  { id: "recipes", to: "/recipes", icon: CookingPotIcon, label: "Recipes" },
  { id: "todo", to: "/todo", icon: CheckSquareIcon, label: "Todo" },
  { id: "apps", to: "/apps", icon: SquaresFourIcon, label: "Apps" },
];

export const BottomNav = ({ active }: { active: NavTab }): ReactElement => (
  <div className="shrink-0 bg-white pb-[env(safe-area-inset-bottom)]">
    <nav className="flex h-20 items-stretch border-slate-100 border-t" aria-label="Primary">
      {ENTRIES.map(({ id, to, icon: Icon, label }) => {
        const on = id === active;
        return (
          <Link
            key={id}
            to={to}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5",
              on ? "text-slate-900" : "text-slate-400",
            )}
          >
            <Icon size={22} weight={on ? "fill" : "regular"} />
            <span className={cn("text-[11px]", on && "font-medium")}>{label}</span>
          </Link>
        );
      })}
    </nav>
    <TimerBar />
  </div>
);
