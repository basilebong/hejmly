import { BasketIcon, BellIcon } from "@phosphor-icons/react";
import { type ReactElement, type ReactNode, useId } from "react";

import { Switch } from "@/components/ui/switch";
import { deviceHint, type HintAction, isDeviceSwitchUsable } from "../notification-status";
import type { Notifications } from "../use-notifications";
import { SectionLabel } from "./SectionLabel";

type Action = { label: string; onClick: () => void };

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
          <span id={hintId} className="mt-0.5 block text-slate-600 text-sm leading-snug">
            {description}
          </span>
        </label>
        {action !== undefined && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1 -ml-1 inline-flex min-h-11 items-center rounded-md px-1 font-medium text-slate-900 text-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          >
            {action.label}
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
  if (action === "retry") return { label: "Try again", onClick: retry };
  if (action === "reload") return { label: "Reload", onClick: () => window.location.reload() };
  return undefined;
};

export const NotificationsSection = ({ notifications }: { notifications: Notifications }) => {
  const { state, device, preferences } = notifications;
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
        <Row
          icon={<BasketIcon size={18} />}
          title="Grocery list"
          description={
            preferences.kind === "error"
              ? "Couldn't load this setting."
              : "When someone adds to the list. Applies to every device where notifications are on."
          }
          action={
            preferences.kind === "error"
              ? { label: "Try again", onClick: notifications.retryPreferences }
              : undefined
          }
          control={(ids) =>
            preferences.kind === "ready" ? (
              <Switch
                id={ids.control}
                aria-labelledby={ids.title}
                aria-describedby={ids.hint}
                checked={preferences.value.grocery_added}
                onCheckedChange={(on) => notifications.setPreference({ grocery_added: on })}
              />
            ) : preferences.kind === "loading" ? (
              <SwitchSkeleton />
            ) : null
          }
        />
      </div>
    </section>
  );
};
