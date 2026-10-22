import type { ConnectedAssistant, OAuthConsentId } from "@hejmly/core/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { BottomNav } from "@/components/BottomNav";
import { signOut, useSession } from "@/lib/auth-client";
import { fetchAssistants, revokeAssistant } from "@/lib/me-api";
import { AssistantsSection } from "./atoms/AssistantsSection";
import { IdentityRow } from "./atoms/IdentityRow";
import { MeTopBar } from "./atoms/MeTopBar";
import { NotificationsSection } from "./atoms/NotificationsSection";
import { SignOutButton } from "./atoms/SignOutButton";
import { useNotifications } from "./use-notifications";

const ASSISTANTS_QUERY_KEY = ["me", "assistants"] as const;
const UNDO_WINDOW_MS = 5000;

type Identity = { userKey: string; name: string; email: string; initial: string };

const deriveIdentity = (
  user: { id: string; name?: string | null; email?: string | null } | undefined,
): Identity => {
  if (user === undefined) return { userKey: "", name: "You", email: "", initial: "·" };
  const trimmedName = user.name?.trim();
  const name =
    trimmedName !== undefined && trimmedName.length > 0 ? trimmedName : (user.email ?? "You");
  const initial = name.charAt(0).toUpperCase() || "·";
  return { userKey: user.id, name, email: user.email ?? "", initial };
};

export const MeScreen = (): ReactElement => {
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const identity = deriveIdentity(session.data?.user);
  const notifications = useNotifications();

  const [hidden, setHidden] = useState<ReadonlySet<OAuthConsentId>>(() => new Set());
  const [signingOut, setSigningOut] = useState(false);
  const timers = useRef<Map<OAuthConsentId, ReturnType<typeof setTimeout>>>(new Map());

  const assistants = useQuery({
    queryKey: ASSISTANTS_QUERY_KEY,
    queryFn: fetchAssistants,
  });

  const setHiddenFlag = (id: OAuthConsentId, on: boolean): void => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const revoke = useMutation({
    mutationFn: (id: OAuthConsentId) => revokeAssistant(id),
    onSuccess: (_result, id) => {
      qc.setQueryData(ASSISTANTS_QUERY_KEY, (prev: ConnectedAssistant[] | undefined) =>
        (prev ?? []).filter((assistant) => assistant.id !== id),
      );
      setHiddenFlag(id, false);
      void qc.invalidateQueries({ queryKey: ASSISTANTS_QUERY_KEY });
    },
    onError: (_error, id) => {
      setHiddenFlag(id, false);
      toast.error("Couldn't revoke that assistant — try again");
    },
  });

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const [id, timer] of pending) {
        clearTimeout(timer);
        void revokeAssistant(id);
      }
      pending.clear();
    };
  }, []);

  const handleRevoke = (assistant: ConnectedAssistant): void => {
    if (timers.current.has(assistant.id)) return;
    setHiddenFlag(assistant.id, true);
    const timer = setTimeout(() => {
      timers.current.delete(assistant.id);
      revoke.mutate(assistant.id);
    }, UNDO_WINDOW_MS);
    timers.current.set(assistant.id, timer);
    toast(`${assistant.name} revoked`, {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const pending = timers.current.get(assistant.id);
          if (pending !== undefined) {
            clearTimeout(pending);
            timers.current.delete(assistant.id);
          }
          setHiddenFlag(assistant.id, false);
        },
      },
    });
  };

  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await signOut();
      qc.clear();
      await router.navigate({ to: "/sign-in", replace: true });
    } catch {
      setSigningOut(false);
      toast.error("Couldn't sign out — try again");
    }
  };

  const visibleAssistants = (assistants.data ?? []).filter(
    (assistant) => !hidden.has(assistant.id),
  );

  return (
    <main className="flex min-h-dvh flex-col bg-slate-50">
      <MeTopBar />
      <div className="flex-1 overflow-y-auto">
        <IdentityRow
          userKey={identity.userKey}
          name={identity.name}
          email={identity.email}
          initial={identity.initial}
        />
        <NotificationsSection notifications={notifications} />
        <AssistantsSection
          isPending={assistants.isPending}
          isError={assistants.isError}
          assistants={visibleAssistants}
          onRevoke={handleRevoke}
          onRetry={() => void assistants.refetch()}
        />
      </div>
      <div className="shrink-0 border-slate-100 border-t bg-slate-50 px-5 pt-2 pb-[max(env(safe-area-inset-bottom),1rem)]">
        <SignOutButton loading={signingOut} onClick={() => void handleSignOut()} />
      </div>
      <BottomNav active="apps" />
    </main>
  );
};
