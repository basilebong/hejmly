import { match } from "ts-pattern";

import type { PushFailure } from "@/lib/push-api";
import type { DeviceStatus } from "@/lib/push-device";
import type { PushState } from "@/lib/push-state";

export type DeviceView =
  | { kind: "checking" }
  | { kind: "check_failed"; retrying: boolean }
  | { kind: "no_worker" }
  | { kind: "turning_on" }
  | { kind: "turning_off" }
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "declined" }
  | { kind: "browser_failed" };

export type DeviceNotice = "declined" | "browser_failed";

export type DeviceQuery =
  | { kind: "pending" }
  | { kind: "error"; retrying: boolean }
  | { kind: "ready"; status: DeviceStatus };

export type DeviceViewInput = {
  query: DeviceQuery;
  busy: "on" | "off" | null;
  notice: DeviceNotice | null;
};

export const deviceViewOf = ({ query, busy, notice }: DeviceViewInput): DeviceView => {
  if (busy === "on") return { kind: "turning_on" };
  if (busy === "off") return { kind: "turning_off" };
  return match(query)
    .returnType<DeviceView>()
    .with({ kind: "pending" }, () => ({ kind: "checking" }))
    .with({ kind: "error" }, ({ retrying }) => ({ kind: "check_failed", retrying }))
    .with({ kind: "ready", status: { kind: "no_worker" } }, () => ({ kind: "no_worker" }))
    .with({ kind: "ready", status: { kind: "on" } }, () => ({ kind: "on" }))
    .with({ kind: "ready", status: { kind: "off" } }, () =>
      notice === null ? { kind: "off" } : { kind: notice },
    )
    .exhaustive();
};

export type HintAction = { kind: "retry" | "reload"; pending: boolean };
export type Hint = { text: string; action?: HintAction };

const viewHint = (view: DeviceView): Hint =>
  match(view)
    .returnType<Hint>()
    .with({ kind: "checking" }, () => ({ text: "Checking this device…" }))
    .with({ kind: "check_failed" }, ({ retrying }) => ({
      text: "Couldn't check this device.",
      action: { kind: "retry", pending: retrying },
    }))
    .with({ kind: "no_worker" }, () => ({
      text: "Hejmly is still setting up on this device.",
      action: { kind: "reload", pending: false },
    }))
    .with({ kind: "turning_on" }, () => ({ text: "Turning on…" }))
    .with({ kind: "turning_off" }, () => ({ text: "Turning off…" }))
    .with({ kind: "on" }, () => ({
      text: "On. If nothing shows up, check the notification settings for Hejmly on this device.",
    }))
    .with({ kind: "off" }, () => ({
      text: "Get notified here when someone adds to the grocery list. Your browser may ask for permission.",
    }))
    .with({ kind: "declined" }, () => ({
      text: "Notifications weren't allowed. Tap the switch to try again. If no prompt appears, allow them in the site or app settings.",
    }))
    .with({ kind: "browser_failed" }, () => ({
      text: "This browser couldn't set up notifications. Try again later.",
    }))
    .exhaustive();

export const deviceHint = (state: PushState, view: DeviceView): Hint =>
  match(state)
    .returnType<Hint>()
    .with({ kind: "needs_install" }, () => ({
      text: "On iPhone and iPad, add Hejmly to your Home Screen first: tap Share, then “Add to Home Screen”, and open it from there. Needs iOS 16.4 or later.",
    }))
    .with({ kind: "needs_newer_ios" }, () => ({
      text: "Notifications need iOS 16.4 or later. Update this iPhone or iPad, then come back.",
    }))
    .with({ kind: "unsupported" }, () => ({
      text: "This browser can't show notifications. Try Chrome, Edge, Firefox or Safari.",
    }))
    .with({ kind: "blocked" }, () => ({
      text: "Notifications are blocked for Hejmly. Allow them in this device's settings for Hejmly, or on a computer in the site settings next to the address bar.",
    }))
    .with({ kind: "available" }, () => viewHint(view))
    .exhaustive();

export const isDeviceSwitchUsable = (state: PushState, view: DeviceView): boolean =>
  state.kind === "available" &&
  (view.kind === "on" ||
    view.kind === "off" ||
    view.kind === "declined" ||
    view.kind === "browser_failed");

export const failureMessage = (failure: PushFailure): string =>
  match(failure)
    .with({ kind: "offline" }, () => "You're offline. Try again when you're connected.")
    .with({ kind: "server" }, () => "Couldn't reach Hejmly. Try again.")
    .with({ kind: "browser" }, () => "This browser couldn't set up notifications.")
    .with(
      { kind: "too_many_devices" },
      () => "Notifications are already on for 10 of your devices. Turn one off first.",
    )
    .exhaustive();
