import { PushSubscriptionInputSchema } from "@hejmly/core/shared";
import * as v from "valibot";

import {
  checkSubscription,
  deleteSubscription,
  fetchVapidPublicKey,
  type PushFailure,
  requestFailureOf,
  saveSubscription,
} from "@/lib/push-api";
import { applicationServerKey } from "@/lib/push-state";

export type DeviceStatus = { kind: "no_worker" } | { kind: "off" } | { kind: "on" };

export type DeviceChange =
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "not_allowed" }
  | { kind: "no_worker" }
  | { kind: "failed"; failure: PushFailure };

const READY_TIMEOUT_MS = 4000;

const registration = async (): Promise<ServiceWorkerRegistration | undefined> => {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), READY_TIMEOUT_MS),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
};

const failed = (failure: PushFailure): DeviceChange => ({ kind: "failed", failure });

const sameKey = (current: ArrayBuffer | null, wanted: Uint8Array): boolean => {
  if (current === null) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === wanted.length && bytes.every((byte, i) => byte === wanted[i]);
};

export const readDevice = async (): Promise<DeviceStatus> => {
  const reg = await registration();
  if (reg === undefined) return { kind: "no_worker" };
  const subscription = await reg.pushManager.getSubscription();
  if (subscription === null) return { kind: "off" };
  const { registered } = await checkSubscription(subscription.endpoint);
  return registered ? { kind: "on" } : { kind: "off" };
};

const subscribe = async (
  reg: ServiceWorkerRegistration,
  key: Uint8Array<ArrayBuffer>,
): Promise<PushSubscription | null> => {
  try {
    const existing = await reg.pushManager.getSubscription();
    if (existing !== null && !sameKey(existing.options.applicationServerKey, key)) {
      await existing.unsubscribe();
    }
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch {
    return null;
  }
};

export const turnOn = async (
  permission: Promise<NotificationPermission>,
): Promise<DeviceChange> => {
  if ((await permission) !== "granted") return { kind: "not_allowed" };
  const reg = await registration();
  if (reg === undefined) return { kind: "no_worker" };
  let key: Uint8Array<ArrayBuffer>;
  try {
    key = applicationServerKey(await fetchVapidPublicKey());
  } catch (error) {
    return failed(requestFailureOf(error, navigator.onLine));
  }
  const subscription = await subscribe(reg, key);
  if (subscription === null) return failed({ kind: "browser" });
  const copy = v.safeParse(PushSubscriptionInputSchema, subscription.toJSON());
  if (!copy.success) {
    await subscription.unsubscribe();
    return failed({ kind: "browser" });
  }
  try {
    await saveSubscription(copy.output);
  } catch (error) {
    await subscription.unsubscribe();
    return failed(requestFailureOf(error, navigator.onLine));
  }
  return { kind: "on" };
};

export const turnOff = async (): Promise<DeviceChange> => {
  const reg = await navigator.serviceWorker.getRegistration();
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription === null || subscription === undefined) return { kind: "off" };
  const { endpoint } = subscription;
  if (!(await subscription.unsubscribe())) return failed({ kind: "browser" });
  try {
    await deleteSubscription(endpoint);
  } catch {
    // The browser no longer holds this subscription, so the push service answers
    // 404/410 for it and the server forgets the device on its next send.
  }
  return { kind: "off" };
};

export const forgetThisDevice = async (): Promise<void> => {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // Signing out must not depend on this. The server drops the device with the
    // session, so a browser-side leftover is never sent to.
  }
};
