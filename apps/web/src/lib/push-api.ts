import {
  type PushDeviceStatus,
  PushDeviceStatusSchema,
  type PushPreferences,
  type PushPreferencesInput,
  PushPreferencesSchema,
  type PushSubscriptionInput,
  VapidPublicKeyResponseSchema,
} from "@hejmly/core/shared";
import { match, P } from "ts-pattern";
import * as v from "valibot";

export class PushApiError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(body || `HTTP ${status}`);
    this.name = "PushApiError";
    this.status = status;
  }
}

export type PushFailure =
  | { kind: "offline" }
  | { kind: "server" }
  | { kind: "browser" }
  | { kind: "too_many_devices" };

export const requestFailureOf = (error: unknown, online: boolean): PushFailure => {
  if (!online) return { kind: "offline" };
  return match(error)
    .returnType<PushFailure>()
    .with(P.instanceOf(PushApiError), (e) =>
      e.status === 409
        ? { kind: "too_many_devices" }
        : e.status === 422
          ? { kind: "browser" }
          : { kind: "server" },
    )
    .otherwise(() => ({ kind: "server" }));
};

const parseJson = async <T>(res: Response, schema: v.GenericSchema<unknown, T>): Promise<T> => {
  if (!res.ok) throw new PushApiError(res.status, await res.text());
  const raw: unknown = await res.json();
  return v.parse(schema, raw);
};

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  credentials: "include",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchVapidPublicKey = async (): Promise<string> => {
  const res = await fetch("/api/push/vapid-public-key", { credentials: "include" });
  return (await parseJson(res, VapidPublicKeyResponseSchema)).publicKey;
};

export const saveSubscription = async (subscription: PushSubscriptionInput): Promise<void> => {
  const res = await fetch("/api/push/subscriptions", jsonInit("POST", subscription));
  if (!res.ok) throw new PushApiError(res.status, await res.text());
};

export const checkSubscription = async (endpoint: string): Promise<PushDeviceStatus> => {
  const res = await fetch("/api/push/subscriptions/check", jsonInit("POST", { endpoint }));
  return parseJson(res, PushDeviceStatusSchema);
};

export const deleteSubscription = async (endpoint: string): Promise<void> => {
  const res = await fetch("/api/push/subscriptions", jsonInit("DELETE", { endpoint }));
  if (!res.ok && res.status !== 404) throw new PushApiError(res.status, await res.text());
};

export const mergePreferences = (
  current: PushPreferences,
  change: PushPreferencesInput,
): PushPreferences => ({ grocery_added: change.grocery_added ?? current.grocery_added });

export const fetchPushPreferences = async (): Promise<PushPreferences> => {
  const res = await fetch("/api/push/preferences", { credentials: "include" });
  return parseJson(res, PushPreferencesSchema);
};

export const updatePushPreferences = async (
  input: PushPreferencesInput,
): Promise<PushPreferences> => {
  const res = await fetch("/api/push/preferences", jsonInit("PATCH", input));
  return parseJson(res, PushPreferencesSchema);
};
