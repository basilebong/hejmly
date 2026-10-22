import type { PushPreferences, PushPreferencesInput } from "@hejmly/core/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { match } from "ts-pattern";

import { fetchPushPreferences, mergePreferences, updatePushPreferences } from "@/lib/push-api";
import { type DeviceStatus, readDevice, turnOff, turnOn } from "@/lib/push-device";
import { type PushState, pushStateOf, readPushEnvironment } from "@/lib/push-state";
import {
  type DeviceNotice,
  type DeviceQuery,
  type DeviceView,
  deviceViewOf,
  failureMessage,
} from "./notification-status";

export const DEVICE_KEY = ["push", "device"] as const;
export const PREFERENCES_KEY = ["push", "preferences"] as const;

type DeviceRequest = { on: true; permission: Promise<NotificationPermission> } | { on: false };

export type PreferencesView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; value: PushPreferences };

export type Notifications = {
  state: PushState;
  device: DeviceView;
  setDevice: (on: boolean) => void;
  retryDevice: () => void;
  preferences: PreferencesView;
  retryPreferences: () => void;
  setPreference: (input: PushPreferencesInput) => void;
};

const usePushState = (): [PushState, () => void] => {
  const [state, setState] = useState<PushState>(() => pushStateOf(readPushEnvironment()));
  const refreshState = () => setState(pushStateOf(readPushEnvironment()));

  useEffect(() => {
    const refresh = () => setState(pushStateOf(readPushEnvironment()));
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    let permission: PermissionStatus | undefined;
    if ("permissions" in navigator) {
      navigator.permissions
        .query({ name: "notifications" })
        .then((status) => {
          permission = status;
          status.addEventListener("change", refresh);
        })
        .catch(() => {});
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      permission?.removeEventListener("change", refresh);
    };
  }, []);

  return [state, refreshState];
};

export const useNotifications = (): Notifications => {
  const qc = useQueryClient();
  const [state, refreshState] = usePushState();
  const [notice, setNotice] = useState<DeviceNotice | null>(null);

  const device = useQuery({
    queryKey: DEVICE_KEY,
    queryFn: readDevice,
    enabled: state.kind === "available",
    meta: { persist: false },
  });

  const preferences = useQuery({ queryKey: PREFERENCES_KEY, queryFn: fetchPushPreferences });

  const toggleDevice = useMutation({
    mutationFn: (change: DeviceRequest) => (change.on ? turnOn(change.permission) : turnOff()),
    onMutate: async ({ on }) => {
      setNotice(null);
      await qc.cancelQueries({ queryKey: DEVICE_KEY });
      const previous = qc.getQueryData<DeviceStatus>(DEVICE_KEY);
      if (!on) qc.setQueryData<DeviceStatus>(DEVICE_KEY, { kind: "off" });
      return { previous };
    },
    onSuccess: (change, { on }, context) => {
      const restore = () => {
        if (context.previous !== undefined) {
          qc.setQueryData<DeviceStatus>(DEVICE_KEY, context.previous);
        }
      };
      match(change)
        .with({ kind: "on" }, () => {
          qc.setQueryData<DeviceStatus>(DEVICE_KEY, { kind: "on" });
          toast.success("Notifications are on for this device");
        })
        .with({ kind: "off" }, () => {
          qc.setQueryData<DeviceStatus>(DEVICE_KEY, { kind: "off" });
        })
        .with({ kind: "not_allowed" }, () => {
          setNotice("declined");
          toast.info("Notifications weren't allowed on this device");
        })
        .with({ kind: "no_worker" }, () => {
          qc.setQueryData<DeviceStatus>(DEVICE_KEY, { kind: "no_worker" });
        })
        .with({ kind: "failed" }, ({ failure }) => {
          restore();
          if (on && failure.kind === "browser") setNotice("browser_failed");
          toast.error(on ? failureMessage(failure) : "Couldn't turn notifications off. Try again.");
        })
        .exhaustive();
    },
    onError: (_error, { on }, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<DeviceStatus>(DEVICE_KEY, context.previous);
      }
      toast.error(on ? "Couldn't turn notifications on" : "Couldn't turn notifications off");
    },
    onSettled: () => {
      refreshState();
      void qc.invalidateQueries({ queryKey: DEVICE_KEY });
    },
  });

  const savePreference = useMutation({
    mutationFn: updatePushPreferences,
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: PREFERENCES_KEY });
      const previous = qc.getQueryData<PushPreferences>(PREFERENCES_KEY);
      if (previous !== undefined) {
        qc.setQueryData<PushPreferences>(PREFERENCES_KEY, mergePreferences(previous, input));
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) {
        qc.setQueryData<PushPreferences>(PREFERENCES_KEY, context.previous);
      }
      toast.error("Couldn't save that setting");
    },
    onSuccess: (saved) => qc.setQueryData<PushPreferences>(PREFERENCES_KEY, saved),
  });

  const deviceQuery: DeviceQuery =
    device.data !== undefined
      ? { kind: "ready", status: device.data }
      : device.isError && !device.isFetching
        ? { kind: "error" }
        : { kind: "pending" };

  const busy = toggleDevice.isPending ? (toggleDevice.variables?.on ? "on" : "off") : null;

  return {
    state,
    device: deviceViewOf({ query: deviceQuery, busy, notice }),
    setDevice: (on) => {
      if (toggleDevice.isPending) return;
      // WebKit only shows the prompt when requestPermission runs inside the tap
      // itself, not after an await: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
      toggleDevice.mutate(
        on ? { on: true, permission: Notification.requestPermission() } : { on: false },
      );
    },
    retryDevice: () => void device.refetch(),
    preferences:
      preferences.data !== undefined
        ? { kind: "ready", value: preferences.data }
        : preferences.isError && !preferences.isFetching
          ? { kind: "error" }
          : { kind: "loading" },
    retryPreferences: () => void preferences.refetch(),
    setPreference: (input) => savePreference.mutate(input),
  };
};
