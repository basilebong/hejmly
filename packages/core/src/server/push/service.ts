import { buildPushPayload } from "@block65/webcrypto-web-push";
import { and, count, eq, ne } from "drizzle-orm";
import {
  err,
  ok,
  PUSH_TOPICS,
  type PushMessage,
  type PushPreferences,
  type PushPreferencesInput,
  type PushSubscriptionId,
  type PushSubscriptionInput,
  type PushTopic,
  parsePushSubscriptionId,
  type Result,
  type UserId,
} from "../../shared/index.ts";
import { users } from "../auth/schema.ts";
import type { Db } from "../db/index.ts";
import { isAllowedPushEndpoint } from "./endpoints.ts";
import { pushPreferences, pushSubscriptions, pushVapidKeys } from "./schema.ts";

export type PushError =
  | { kind: "endpoint_not_allowed" }
  | { kind: "too_many_devices" }
  | { kind: "not_found" };

export type PushRequest = {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array<ArrayBuffer>;
};

export type PushSender = (request: PushRequest) => Promise<{ status: number }>;

export const fetchPushSender =
  (timeoutMs = 10_000): PushSender =>
  async (request) => {
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status };
  };

export type PushServiceOptions = {
  isMember: (email: string | null) => boolean;
  subject: string;
  send: PushSender;
  isAllowedEndpoint?: (url: string) => boolean;
};

export type PushAudience = { except?: UserId };
export type PushOutcome = { sent: number; removed: number; failed: number };

export type PushService = {
  publicKey(): Promise<string>;
  subscribe(
    userId: UserId,
    input: PushSubscriptionInput,
  ): Promise<Result<{ id: PushSubscriptionId }, PushError>>;
  unsubscribe(userId: UserId, endpoint: string): Promise<Result<{ endpoint: string }, PushError>>;
  preferences(userId: UserId): Promise<PushPreferences>;
  updatePreferences(userId: UserId, input: PushPreferencesInput): Promise<PushPreferences>;
  notify(topic: PushTopic, audience: PushAudience, message: PushMessage): Promise<PushOutcome>;
};

export const MAX_DEVICES_PER_PERSON = 10;
const MESSAGE_TTL_SECONDS = 6 * 60 * 60;
const KEY_ROW = "default";

type VapidKeys = { publicKey: string; privateKey: string };

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const generateVapidKeys = async (): Promise<VapidKeys> => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (jwk.d === undefined) throw new Error("push: generated VAPID key has no private part");
  return { publicKey: toBase64Url(raw), privateKey: jwk.d };
};

const originOf = (endpoint: string): string => {
  try {
    return new URL(endpoint).origin;
  } catch {
    return "invalid-endpoint";
  }
};

export const createPushService = (db: Db, options: PushServiceOptions): PushService => {
  const allowed = options.isAllowedEndpoint ?? isAllowedPushEndpoint;
  let keys: Promise<VapidKeys> | null = null;

  const loadKeys = async (): Promise<VapidKeys> => {
    const fresh = await generateVapidKeys();
    await db
      .insert(pushVapidKeys)
      .values({ id: KEY_ROW, ...fresh, createdAt: new Date() })
      .onConflictDoNothing();
    const rows = await db.select().from(pushVapidKeys).where(eq(pushVapidKeys.id, KEY_ROW));
    const row = rows[0];
    if (row === undefined) throw new Error("push: VAPID keys missing after insert");
    return { publicKey: row.publicKey, privateKey: row.privateKey };
  };

  const vapidKeys = (): Promise<VapidKeys> => {
    if (keys === null) {
      keys = loadKeys().catch((error: unknown) => {
        keys = null;
        throw error;
      });
    }
    return keys;
  };

  const preferences = async (userId: UserId): Promise<PushPreferences> => {
    const rows = await db.select().from(pushPreferences).where(eq(pushPreferences.userId, userId));
    const chosen = new Map(rows.map((r) => [r.topic, r.enabled]));
    return { grocery_added: chosen.get("grocery_added") ?? true };
  };

  return {
    async publicKey() {
      return (await vapidKeys()).publicKey;
    },

    async subscribe(userId, input) {
      if (!allowed(input.endpoint)) return err({ kind: "endpoint_not_allowed" });
      const now = new Date();
      const fresh = parsePushSubscriptionId(crypto.randomUUID());
      const outcome = db.transaction(
        (tx): Result<{ id: PushSubscriptionId }, PushError> => {
          const existing = tx
            .select({ id: pushSubscriptions.id })
            .from(pushSubscriptions)
            .where(eq(pushSubscriptions.endpoint, input.endpoint))
            .all()[0];
          if (existing !== undefined) {
            tx.update(pushSubscriptions)
              .set({ userId, p256dh: input.keys.p256dh, auth: input.keys.auth, updatedAt: now })
              .where(eq(pushSubscriptions.id, existing.id))
              .run();
            return ok({ id: parsePushSubscriptionId(existing.id) });
          }
          const devices =
            tx
              .select({ n: count() })
              .from(pushSubscriptions)
              .where(eq(pushSubscriptions.userId, userId))
              .all()[0]?.n ?? 0;
          if (devices >= MAX_DEVICES_PER_PERSON) return err({ kind: "too_many_devices" });
          tx.insert(pushSubscriptions)
            .values({
              id: fresh,
              userId,
              endpoint: input.endpoint,
              p256dh: input.keys.p256dh,
              auth: input.keys.auth,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          return ok({ id: fresh });
        },
        { behavior: "immediate" },
      );
      return outcome;
    },

    async unsubscribe(userId, endpoint) {
      const deleted = await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
        .returning({ endpoint: pushSubscriptions.endpoint });
      const row = deleted[0];
      return row === undefined ? err({ kind: "not_found" }) : ok({ endpoint: row.endpoint });
    },

    preferences,

    async updatePreferences(userId, input) {
      for (const topic of PUSH_TOPICS) {
        const enabled = input[topic];
        if (enabled === undefined) continue;
        await db
          .insert(pushPreferences)
          .values({ userId, topic, enabled })
          .onConflictDoUpdate({
            target: [pushPreferences.userId, pushPreferences.topic],
            set: { enabled },
          });
      }
      return preferences(userId);
    },

    async notify(topic, audience, message) {
      const rows = await db
        .select({
          id: pushSubscriptions.id,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
          email: users.email,
          enabled: pushPreferences.enabled,
        })
        .from(pushSubscriptions)
        .innerJoin(users, eq(users.id, pushSubscriptions.userId))
        .leftJoin(
          pushPreferences,
          and(
            eq(pushPreferences.userId, pushSubscriptions.userId),
            eq(pushPreferences.topic, topic),
          ),
        )
        .where(
          audience.except === undefined ? undefined : ne(pushSubscriptions.userId, audience.except),
        );
      const targets = rows.filter((r) => options.isMember(r.email) && r.enabled !== false);
      if (targets.length === 0) return { sent: 0, removed: 0, failed: 0 };

      const vapid = { subject: options.subject, ...(await vapidKeys()) };
      const results = await Promise.all(
        targets.map(async (target): Promise<keyof PushOutcome> => {
          try {
            const payload = await buildPushPayload(
              { data: message, options: { ttl: MESSAGE_TTL_SECONDS, topic: message.tag } },
              {
                endpoint: target.endpoint,
                expirationTime: null,
                keys: { p256dh: target.p256dh, auth: target.auth },
              },
              vapid,
            );
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(payload.headers)) {
              if (typeof value === "string") headers[name] = value;
            }
            const { status } = await options.send({
              endpoint: target.endpoint,
              method: payload.method,
              headers,
              body: payload.body,
            });
            if (status >= 200 && status < 300) return "sent";
            if (status === 404 || status === 410) {
              await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, target.id));
              console.info("push: device gone, removed", {
                origin: originOf(target.endpoint),
                status,
              });
              return "removed";
            }
            console.error("push: delivery rejected", { origin: originOf(target.endpoint), status });
            return "failed";
          } catch (error) {
            console.error("push: delivery failed", {
              origin: originOf(target.endpoint),
              error: error instanceof Error ? error.message : String(error),
            });
            return "failed";
          }
        }),
      );
      return {
        sent: results.filter((r) => r === "sent").length,
        removed: results.filter((r) => r === "removed").length,
        failed: results.filter((r) => r === "failed").length,
      };
    },
  };
};
