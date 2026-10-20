import type { TodoAuthor } from "@hejmly/app-todo/shared";
import { parseUserId } from "@hejmly/core/shared";

import { useSession } from "@/lib/auth-client";

export const useTodoIdentity = (): TodoAuthor => {
  const session = useSession();
  const user = session.data?.user;
  if (user === undefined) return { kind: "unknown", name: "You", initial: "·" };
  const trimmed = user.name?.trim();
  const name = trimmed !== undefined && trimmed.length > 0 ? trimmed : (user.email ?? "You");
  const initial = name.charAt(0).toUpperCase() || "·";
  return { kind: "user", id: parseUserId(user.id), name, initial };
};
