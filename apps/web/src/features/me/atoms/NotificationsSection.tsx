import type { PushTopic } from "@hejmly/core/shared";
import { BasketIcon, BellIcon, CheckSquareIcon } from "@phosphor-icons/react";
import { type ReactElement, type ReactNode, useEffect, useId, useRef } from "react";

import { Switch } from "@/components/ui/switch";
import { deviceHint, type HintAction, isDeviceSwitchUsable } from "../notification-status";
import type { Notifications } from "../use-notifications";
import { SectionLabel } from "./SectionLabel";

type Action = { label: string; pending: boolean; onClick: () => void };

type RowProps = {
  icon: ReactNode;
  title: string;
  description: string;
  action?: Action | undefined;
  control: (ids: { control: string; title: string; hint: string }) => ReactNode;
};

const Row = ({ icon, title, description, action, control }: RowProps): ReactElement => {
  const controlId = useId();
  const titleId = useId();
  const hintId = useId();
  const refocus = useRef(false);
  const hasAction = action !== undefined;

  useEffect(() => {
    if (hasAction || !refocus.current) return;
    refocus.current = false;
    if (document.activeElement === null || document.activeElement === document.body) {
      document.getElementById(controlId)?.focus();
    }
  }, [hasAction, controlId]);

  return (
    <div className="flex min-h-16 items-center gap-3 px-5 py-3">
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <label htmlFor={controlId} className="block">
          <span id={titleId} className="block font-medium text-base text-slate-900">
            {title}
          </span>
          <span
            id={hintId}
            aria-live="polite"
            className="mt-0.5 block text-slate-600 text-sm leading-snug"
          >
            {description}
          </span>
        </label>
        {action !== undefined && (
          <button
            type="button"
            aria-disabled={action.pending || undefined}
            onClick={() => {
              if (action.pending) return;
              refocus.current = true;
              action.onClick();
            }}
            className="mt-1 -ml-1 inline-flex min-h-11 items-center rounded-md px-1 font-medium text-slate-900 text-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          >
            {action.pending ? "Checking…" : action.label}
          </button>
        )}
      </div>
      {control({ control: controlId, title: titleId, hint: hintId })}
    </div>
  );
};

const SwitchSkeleton = (): ReactElement => (
  <span aria-hidden className="h-7 w-12 shrink-0 animate-pulse rounded-full bg-slate-200" />
);

const actionFor = (action: HintAction | undefined, retry: () => void): Action | undefined => {
  if (action === undefined) return undefined;
  return action.kind === "retry"
    ? { label: "Try again", pending: action.pending, onClick: retry }
    : { label: "Reload", pending: action.pending, onClick: () => window.location.reload() };
};

type TopicRowProps = {
  notifications: Notifications;
  topic: PushTopic;
  icon: ReactNode;
  title: string;
  description: string;
  reportsLoadError: boolean;
};

const TopicRow = ({
  notifications,
  topic,
  icon,
  title,
  description,
  reportsLoadError,
}: TopicRowProps): ReactElement | null => {
  const { preferences } = notifications;
  if (preferences.kind === "error" && !reportsLoadError) return null;
  return (
    <Row
      icon={icon}
      title={preferences.kind === "error" ? "Grocery and tasks" : title}
      description={
        preferences.kind === "error" ? "Couldn't load your notification settings." : description
      }
      action={
        preferences.kind === "error"
          ? {
              label: "Try again",
              pending: preferences.retrying,
              onClick: notifications.retryPreferences,
            }
          : undefined
      }
      control={(ids) =>
        preferences.kind === "ready" ? (
          <Switch
            id={ids.control}
            aria-labelledby={ids.title}
            aria-describedby={ids.hint}
            checked={preferences.value[topic]}
            onCheckedChange={(on) => notifications.setPreference({ [topic]: on })}
          />
        ) : preferences.kind === "loading" ? (
          <SwitchSkeleton />
        ) : null
      }
    />
  );
};

export const NotificationsSection = ({ notifications }: { notifications: Notifications }) => {
  const { state, device } = notifications;
  const headingId = useId();
  const hint = deviceHint(state, device);
  const busy = device.kind === "turning_on" || device.kind === "turning_off";
  const usable = isDeviceSwitchUsable(state, device);

  return (
    <section aria-labelledby={headingId}>
      <SectionLabel id={headingId}>Notifications</SectionLabel>
      <div className="divide-y divide-slate-100 bg-white">
        <Row
          icon={<BellIcon size={18} />}
          title="This device"
          description={hint.text}
          action={actionFor(hint.action, notifications.retryDevice)}
          control={(ids) => (
            <Switch
              id={ids.control}
              aria-labelledby={ids.title}
              aria-describedby={ids.hint}
              aria-busy={busy}
              aria-disabled={busy || undefined}
              checked={device.kind === "on"}
              disabled={!busy && !usable}
              onCheckedChange={(on) => {
                if (!busy) notifications.setDevice(on);
              }}
            />
          )}
        />
        <TopicRow
          notifications={notifications}
          topic="grocery_added"
          icon={<BasketIcon size={18} />}
          title="Grocery list"
          description="When someone adds to the list."
          reportsLoadError
        />
        <TopicRow
          notifications={notifications}
          topic="todo_due"
          icon={<CheckSquareIcon size={18} />}
          title="Tasks due"
          description="At 8 in the morning, when tasks assigned to you are due or overdue."
          reportsLoadError={false}
        />
      </div>
      <p className="px-5 pt-2 text-slate-600 text-sm leading-snug">
        Grocery and task settings apply to every device where notifications are on.
      </p>
    </section>
  );
};
