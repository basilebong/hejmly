import {
  type PushPreferences,
  type PushPreferencesInput,
  PushSubscriptionInputSchema,
} from "@hejmly/core/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { match } from "ts-pattern";
import * as v from "valibot";

import {
  deleteSubscription,
  fetchPushPreferences,
  fetchVapidPublicKey,
  mergePreferences,
  saveSubscription,
  updatePushPreferences,
} from "@/lib/push-api";
import {
  applicationServerKey,
  type PushState,
  pushStateOf,
  readPushEnvironment,
} from "@/lib/push-state";

const DEVICE_KEY = ["push", "device"] as const;
const PREFERENCES_KEY = ["push", "preferences"] as const;

type DeviceStatus = { worker: boolean; subscribed: boolean };

const registration = async (): Promise<ServiceWorkerRegistration | undefined> =>
  navigator.serviceWorker.getRegistration();

const serverCopy = (subscription: PushSubscription) =>
  v.parse(PushSubscriptionInputSchema, subscription.toJSON());

const readDevice = async (): Promise<DeviceStatus> => {
  const reg = await registration();
  if (reg === undefined) return { worker: false, subscribed: false };
  const subscription = await reg.pushManager.getSubscription();
  if (subscription !== null) await saveSubscription(serverCopy(subscription));
  return { worker: true, subscribed: subscription !== null };
};

type DeviceChange =
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "not_allowed" }
  | { kind: "no_worker" };

const turnOn = async (): Promise<DeviceChange> => {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { kind: "not_allowed" };
  const reg = await registration();
  if (reg === undefined) return { kind: "no_worker" };
  const key = await fetchVapidPublicKey();
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(key),
  });
  try {
    await saveSubscription(serverCopy(subscription));
  } catch (error) {
    await subscription.unsubscribe();
    throw error;
  }
  return { kind: "on" };
};

const turnOff = async (): Promise<DeviceChange> => {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription === null || subscription === undefined) return { kind: "off" };
  await deleteSubscription(subscription.endpoint);
  await subscription.unsubscribe();
  return { kind: "off" };
};

export type Notifications = {
  state: PushState;
  device: { loading: boolean; worker: boolean; subscribed: boolean; busy: boolean };
  setDevice: (on: boolean) => void;
  preferences: PushPreferences | undefined;
  setPreference: (input: PushPreferencesInput) => void;
};

export const useNotifications = (): Notifications => {
  const qc = useQueryClient();
  const [state, setState] = useState<PushState>(() => pushStateOf(readPushEnvironment()));

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setState(pushStateOf(readPushEnvironment()));
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  const device = useQuery({
    queryKey: DEVICE_KEY,
    queryFn: readDevice,
    enabled: state.kind === "available",
    staleTime: Number.POSITIVE_INFINITY,
  });

  const preferences = useQuery({ queryKey: PREFERENCES_KEY, queryFn: fetchPushPreferences });

  const toggleDevice = useMutation({
    mutationFn: (on: boolean) => (on ? turnOn() : turnOff()),
    onSuccess: (change) => {
      setState(pushStateOf(readPushEnvironment()));
      match(change)
        .with({ kind: "on" }, () => {
          qc.setQueryData<DeviceStatus>(DEVICE_KEY, { worker: true, subscribed: true });
          toast.success("Notifications are on for this device");
        })
        .with({ kind: "off" }, () => {
          qc.setQueryData<DeviceStatus>(DEVICE_KEY, { worker: true, subscribed: false });
        })
        .with({ kind: "not_allowed" }, () => toast.info("Notifications weren't allowed"))
        .with({ kind: "no_worker" }, () => toast.error("Reload Hejmly once, then try again"))
        .exhaustive();
    },
    onError: (_error, on) => {
      setState(pushStateOf(readPushEnvironment()));
      toast.error(on ? "Couldn't turn notifications on" : "Couldn't turn notifications off");
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

  return {
    state,
    device: {
      loading: state.kind === "available" && device.isPending,
      worker: device.data?.worker ?? false,
      subscribed: device.data?.subscribed ?? false,
      busy: toggleDevice.isPending,
    },
    setDevice: (on) => toggleDevice.mutate(on),
    preferences: preferences.data,
    setPreference: (input) => savePreference.mutate(input),
  };
};
