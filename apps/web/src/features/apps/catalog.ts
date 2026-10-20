import {
  BasketIcon,
  CheckSquareIcon,
  CookingPotIcon,
  type Icon,
  NoteIcon,
  UserIcon,
} from "@phosphor-icons/react";

export type AppRoute = "/grocery" | "/recipes" | "/todo" | "/me";

export type AppStatus = { kind: "live"; to: AppRoute } | { kind: "soon" };

export type AppEntry = {
  id: string;
  name: string;
  note: string;
  icon: Icon;
  status: AppStatus;
};

export const APP_CATALOG: readonly AppEntry[] = [
  {
    id: "grocery",
    name: "Grocery",
    note: "Shared list",
    icon: BasketIcon,
    status: { kind: "live", to: "/grocery" },
  },
  {
    id: "recipes",
    name: "Recipes",
    note: "Meal ideas",
    icon: CookingPotIcon,
    status: { kind: "live", to: "/recipes" },
  },
  {
    id: "todo",
    name: "Todo",
    note: "Projects",
    icon: CheckSquareIcon,
    status: { kind: "live", to: "/todo" },
  },
  {
    id: "me",
    name: "Me",
    note: "Account",
    icon: UserIcon,
    status: { kind: "live", to: "/me" },
  },
  {
    id: "notes",
    name: "Notes",
    note: "Soon",
    icon: NoteIcon,
    status: { kind: "soon" },
  },
];
