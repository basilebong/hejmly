import { Hono } from "hono";
import * as v from "valibot";
import {
  PushEndpointInputSchema,
  PushPreferencesInputSchema,
  PushSubscriptionInputSchema,
  parseSessionId,
  parseUserId,
} from "../../shared/index.ts";
import type { SessionVariables } from "../middleware/session.ts";
import type { PushError, PushService } from "./service.ts";

export type PushRoutesDeps = { service: PushService };

const STATUS: Record<PushError["kind"], 401 | 404 | 409 | 422 | 503> = {
  endpoint_not_allowed: 422,
  too_many_devices: 409,
  session_expired: 401,
  not_found: 404,
  unavailable: 503,
};

const readJson = async (req: Request): Promise<unknown> => {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
};

const invalid = { kind: "invalid_input" } as const;

export const createPushRoutes = ({ service }: PushRoutesDeps) =>
  new Hono<{ Variables: SessionVariables }>()
    .get("/vapid-public-key", async (c) => c.json({ publicKey: await service.publicKey() }))
    .post("/subscriptions", async (c) => {
      const parsed = v.safeParse(PushSubscriptionInputSchema, await readJson(c.req.raw));
      if (!parsed.success) return c.json(invalid, 400);
      const result = await service.subscribe(
        { userId: parseUserId(c.get("user").id), sessionId: parseSessionId(c.get("session").id) },
        parsed.output,
      );
      if (result.kind === "err") return c.json(result.error, STATUS[result.error.kind]);
      return c.json({ id: result.value.id }, 201);
    })
    .post("/subscriptions/check", async (c) => {
      const parsed = v.safeParse(PushEndpointInputSchema, await readJson(c.req.raw));
      if (!parsed.success) return c.json(invalid, 400);
      const result = await service.registered(
        parseUserId(c.get("user").id),
        parsed.output.endpoint,
      );
      if (result.kind === "err") return c.json(result.error, STATUS[result.error.kind]);
      return c.json(result.value);
    })
    .delete("/subscriptions", async (c) => {
      const parsed = v.safeParse(PushEndpointInputSchema, await readJson(c.req.raw));
      if (!parsed.success) return c.json(invalid, 400);
      const result = await service.unsubscribe(
        parseUserId(c.get("user").id),
        parsed.output.endpoint,
      );
      if (result.kind === "err") return c.json(result.error, STATUS[result.error.kind]);
      return c.json({ ok: true });
    })
    .get("/preferences", async (c) =>
      c.json(await service.preferences(parseUserId(c.get("user").id))),
    )
    .patch("/preferences", async (c) => {
      const parsed = v.safeParse(PushPreferencesInputSchema, await readJson(c.req.raw));
      if (!parsed.success) return c.json(invalid, 400);
      const result = await service.updatePreferences(parseUserId(c.get("user").id), parsed.output);
      if (result.kind === "err") return c.json(result.error, STATUS[result.error.kind]);
      return c.json(result.value);
    });
