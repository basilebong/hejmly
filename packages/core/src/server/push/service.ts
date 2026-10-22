import { buildPushPayload } from "@block65/webcrypto-web-push";
import { and, count, eq, gt, ne } from "drizzle-orm";
import * as v from "valibot";
import {
  err,
  ok,
  PUSH_TOPICS,
  type PushDeviceStatus,
  type PushMessage,
  PushMessageSchema,
  type PushPreferences,
  type PushPreferencesInput,
  PushPreferencesSchema,
  type PushSubscriptionId,
  type PushSubscriptionInput,
  type PushTopic,
  parsePushSubscriptionId,
  type Result,
  type SessionId,
  type UserId,
} from "../../shared/index.ts";
import { sessions, users } from "../auth/schema.ts";
import type { Db } from "../db/index.ts";
import { normalizePushEndpoint } from "./endpoints.ts";
import { pushPreferences, pushSubscriptions, pushVapidKeys } from "./schema.ts";

export type PushError =
  | { kind: "endpoint_not_allowed" }
  | { kind: "too_many_devices" }
  | { kind: "session_expired" }
  | { kind: "not_found" }
  | { kind: "unavailable" };

export type NotifyError = { kind: "invalid_message" } | { kind: "unavailable" };

export type PushSubscriber = { userId: UserId; sessionId: SessionId };

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
};

export type PushAudience = { except?: UserId; only?: UserId };
export type PushOutcome = { sent: number; removed: number; failed: number };

export type PushService = {
  publicKey(): Promise<string>;
  subscribe(
    who: PushSubscriber,
    input: PushSubscriptionInput,
  ): Promise<Result<{ id: PushSubscriptionId }, PushError>>;
  unsubscribe(userId: UserId, endpoint: string): Promise<Result<{ endpoint: string }, PushError>>;
  registered(userId: UserId, endpoint: string): Promise<Result<PushDeviceStatus, PushError>>;
  preferences(userId: UserId): Promise<PushPreferences>;
  updatePreferences(
    userId: UserId,
    input: PushPreferencesInput,
  ): Promise<Result<PushPreferences, PushError>>;
  notify(
    topic: PushTopic,
    audience: PushAudience,
    message: PushMessage,
  ): Promise<Result<PushOutcome, NotifyError>>;
};

export const MAX_DEVICES_PER_PERSON = 10;
export const MAX_REFUSALS = 3;
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

const codeOf = (error: unknown): string | undefined => {
  for (let current = error; typeof current === "object" && current !== null; ) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
};

const unavailable = (op: string, error: unknown): Result<never, PushError> => {
  console.error("push: storage failed", {
    op,
    error: error instanceof Error ? error.name : typeof error,
    code: codeOf(error),
  });
  return err({ kind: "unavailable" });
};

const isTransient = (status: number): boolean => status === 429 || status >= 500;

export const createPushService = (db: Db, options: PushServiceOptions): PushService => {
  let keys: Promise<VapidKeys> | null = null;

  const storedKeys = async (): Promise<VapidKeys | undefined> => {
    const row = (await db.select().from(pushVapidKeys).where(eq(pushVapidKeys.id, KEY_ROW)))[0];
    return row === undefined ? undefined : { publicKey: row.publicKey, privateKey: row.privateKey };
  };

  const loadKeys = async (): Promise<VapidKeys> => {
    const existing = await storedKeys();
    if (existing !== undefined) return existing;
    const fresh = await generateVapidKeys();
    await db
      .insert(pushVapidKeys)
      .values({ id: KEY_ROW, ...fresh, createdAt: new Date() })
      .onConflictDoNothing();
    const stored = await storedKeys();
    if (stored === undefined) throw new Error("push: VAPID keys missing after insert");
    return stored;
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
    return v.parse(
      PushPreferencesSchema,
      Object.fromEntries(PUSH_TOPICS.map((topic) => [topic, chosen.get(topic) ?? true])),
    );
  };

  const notifyTargets = (topic: PushTopic, audience: PushAudience, now: Date) =>
    db
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        refusals: pushSubscriptions.refusals,
        email: users.email,
        enabled: pushPreferences.enabled,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .innerJoin(
        sessions,
        and(eq(sessions.id, pushSubscriptions.sessionId), gt(sessions.expiresAt, now)),
      )
      .leftJoin(
        pushPreferences,
        and(eq(pushPreferences.userId, pushSubscriptions.userId), eq(pushPreferences.topic, topic)),
      )
      .where(
        and(
          audience.except === undefined ? undefined : ne(pushSubscriptions.userId, audience.except),
          audience.only === undefined ? undefined : eq(pushSubscriptions.userId, audience.only),
        ),
      );

  const forget = async (id: string, endpoint: string, reason: string, status?: number) => {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
    console.info(`push: ${reason}, removed`, { origin: originOf(endpoint), status });
  };

  return {
    async publicKey() {
      return (await vapidKeys()).publicKey;
    },

    async subscribe(who, input) {
      const target = normalizePushEndpoint(input.endpoint);
      if (target === null) return err({ kind: "endpoint_not_allowed" });
      const now = new Date();
      const fresh = parsePushSubscriptionId(crypto.randomUUID());
      try {
        return db.transaction(
          (tx): Result<{ id: PushSubscriptionId }, PushError> => {
            const live = tx
              .select({ id: sessions.id })
              .from(sessions)
              .where(
                and(
                  eq(sessions.id, who.sessionId),
                  eq(sessions.userId, who.userId),
                  gt(sessions.expiresAt, now),
                ),
              )
              .all()[0];
            if (live === undefined) return err({ kind: "session_expired" });
            const existing = tx
              .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
              .from(pushSubscriptions)
              .where(eq(pushSubscriptions.endpoint, target))
              .all()[0];
            if (existing?.userId !== who.userId) {
              const devices =
                tx
                  .select({ n: count() })
                  .from(pushSubscriptions)
                  .where(eq(pushSubscriptions.userId, who.userId))
                  .all()[0]?.n ?? 0;
              if (devices >= MAX_DEVICES_PER_PERSON) return err({ kind: "too_many_devices" });
            }
            const device = {
              userId: who.userId,
              sessionId: who.sessionId,
              p256dh: input.keys.p256dh,
              auth: input.keys.auth,
              refusals: 0,
              updatedAt: now,
            };
            if (existing !== undefined) {
              tx.update(pushSubscriptions)
                .set(device)
                .where(eq(pushSubscriptions.id, existing.id))
                .run();
              return ok({ id: parsePushSubscriptionId(existing.id) });
            }
            tx.insert(pushSubscriptions)
              .values({ ...device, id: fresh, endpoint: target, createdAt: now })
              .run();
            return ok({ id: fresh });
          },
          { behavior: "immediate" },
        );
      } catch (error) {
        return unavailable("subscribe", error);
      }
    },

    async unsubscribe(userId, endpoint) {
      const target = normalizePushEndpoint(endpoint);
      if (target === null) return err({ kind: "not_found" });
      try {
        const deleted = await db
          .delete(pushSubscriptions)
          .where(and(eq(pushSubscriptions.endpoint, target), eq(pushSubscriptions.userId, userId)))
          .returning({ endpoint: pushSubscriptions.endpoint });
        const row = deleted[0];
        return row === undefined ? err({ kind: "not_found" }) : ok({ endpoint: row.endpoint });
      } catch (error) {
        return unavailable("unsubscribe", error);
      }
    },

    async registered(userId, endpoint) {
      const target = normalizePushEndpoint(endpoint);
      if (target === null) return ok({ registered: false });
      try {
        const rows = await db
          .select({ id: pushSubscriptions.id })
          .from(pushSubscriptions)
          .where(and(eq(pushSubscriptions.endpoint, target), eq(pushSubscriptions.userId, userId)));
        return ok({ registered: rows.length > 0 });
      } catch (error) {
        return unavailable("registered", error);
      }
    },

    preferences,

    async updatePreferences(userId, input) {
      try {
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
        return ok(await preferences(userId));
      } catch (error) {
        return unavailable("preferences", error);
      }
    },

    async notify(topic, audience, input) {
      const parsed = v.safeParse(PushMessageSchema, input);
      if (!parsed.success) return err({ kind: "invalid_message" });
      const message = parsed.output;
      const now = new Date();
      let rows: Awaited<ReturnType<typeof notifyTargets>>;
      let vapid: { subject: string } & VapidKeys;
      try {
        rows = await notifyTargets(topic, audience, now);
        vapid = { subject: options.subject, ...(await vapidKeys()) };
      } catch (error) {
        console.error("push: notify failed", {
          error: error instanceof Error ? error.name : typeof error,
          code: codeOf(error),
        });
        return err({ kind: "unavailable" });
      }
      const targets = rows.filter((r) => options.isMember(r.email) && r.enabled !== false);
      if (targets.length === 0) return ok({ sent: 0, removed: 0, failed: 0 });

      const results = await Promise.all(
        targets.map(async (target): Promise<keyof PushOutcome> => {
          try {
            if (normalizePushEndpoint(target.endpoint) !== target.endpoint) {
              await forget(target.id, target.endpoint, "endpoint no longer allowed");
              return "removed";
            }
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
            if (status >= 200 && status < 300) {
              if (target.refusals > 0) {
                await db
                  .update(pushSubscriptions)
                  .set({ refusals: 0 })
                  .where(eq(pushSubscriptions.id, target.id));
              }
              return "sent";
            }
            if (status === 404 || status === 410) {
              await forget(target.id, target.endpoint, "device gone", status);
              return "removed";
            }
            if (!isTransient(status)) {
              const refusals = target.refusals + 1;
              if (refusals >= MAX_REFUSALS) {
                await forget(target.id, target.endpoint, "device keeps refusing", status);
                return "removed";
              }
              await db
                .update(pushSubscriptions)
                .set({ refusals })
                .where(eq(pushSubscriptions.id, target.id));
            }
            console.error("push: delivery rejected", { origin: originOf(target.endpoint), status });
            return "failed";
          } catch (error) {
            console.error("push: delivery failed", {
              origin: originOf(target.endpoint),
              error: error instanceof Error ? error.name : typeof error,
              code: codeOf(error),
            });
            return "failed";
          }
        }),
      );
      return ok({
        sent: results.filter((r) => r === "sent").length,
        removed: results.filter((r) => r === "removed").length,
        failed: results.filter((r) => r === "failed").length,
      });
    },
  };
};
