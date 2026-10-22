import { BasketIcon, BellIcon } from "@phosphor-icons/react";
import { type ReactElement, type ReactNode, useId } from "react";
import { match } from "ts-pattern";

import { Switch } from "@/components/ui/switch";
import type { Notifications } from "../use-notifications";
import { SectionLabel } from "./SectionLabel";

type RowProps = {
  icon: ReactNode;
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
};

const Row = ({ icon, title, description, checked, disabled, onChange }: RowProps): ReactElement => {
  const id = useId();
  const hint = useId();
  return (
    <div className="flex min-h-16 items-center gap-3 px-5 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-slate-700">
        {icon}
      </span>
      <label htmlFor={id} className="min-w-0 flex-1">
        <span className="block font-medium text-base text-slate-900">{title}</span>
        <span id={hint} className="mt-0.5 block text-slate-600 text-sm leading-snug">
          {description}
        </span>
      </label>
      <Switch
        id={id}
        aria-describedby={hint}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
};

const deviceHint = (n: Notifications): string =>
  match(n.state)
    .with(
      { kind: "needs_install" },
      () =>
        "On iPhone and iPad, add Hejmly to your Home Screen first: tap Share, then “Add to Home Screen”, and open it from there.",
    )
    .with({ kind: "unsupported" }, () => "This browser can't show notifications.")
    .with(
      { kind: "blocked" },
      () =>
        "Notifications are blocked for Hejmly. Allow them in your browser or phone settings, then come back.",
    )
    .with({ kind: "available" }, () => {
      if (n.device.loading) return "Checking this device…";
      if (!n.device.worker) return "Reload Hejmly once to turn notifications on here.";
      return n.device.subscribed
        ? "On. Your phone or browser may still ask before showing them."
        : "Get notified here when something happens in the household.";
    })
    .exhaustive();

export const NotificationsSection = ({ notifications }: { notifications: Notifications }) => {
  const { state, device, preferences } = notifications;
  const deviceUsable =
    state.kind === "available" && !device.loading && device.worker && !device.busy;
  return (
    <section aria-label="Notifications">
      <SectionLabel>Notifications</SectionLabel>
      <div className="divide-y divide-slate-100 bg-white">
        <Row
          icon={<BellIcon size={18} />}
          title="This device"
          description={deviceHint(notifications)}
          checked={device.subscribed}
          disabled={!deviceUsable}
          onChange={notifications.setDevice}
        />
        <Row
          icon={<BasketIcon size={18} />}
          title="Grocery list"
          description="When someone adds something to the list."
          checked={preferences?.grocery_added ?? true}
          disabled={preferences === undefined}
          onChange={(on) => notifications.setPreference({ grocery_added: on })}
        />
      </div>
    </section>
  );
};
