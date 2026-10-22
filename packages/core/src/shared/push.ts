import * as v from "valibot";

export const PUSH_TOPICS = ["grocery_added", "todo_due"] as const;
export const PushTopicSchema = v.picklist(PUSH_TOPICS);
export type PushTopic = v.InferOutput<typeof PushTopicSchema>;

const base64url = (min: number, max: number) =>
  v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]+={0,2}$/), v.minLength(min), v.maxLength(max));

export const PUSH_ENDPOINT_MAX = 2048;

export const PushSubscriptionInputSchema = v.object({
  endpoint: v.pipe(v.string(), v.maxLength(PUSH_ENDPOINT_MAX), v.url()),
  expirationTime: v.optional(v.nullable(v.number())),
  keys: v.object({ p256dh: base64url(87, 88), auth: base64url(22, 24) }),
});
export type PushSubscriptionInput = v.InferOutput<typeof PushSubscriptionInputSchema>;

export const PushEndpointInputSchema = v.object({
  endpoint: v.pipe(v.string(), v.maxLength(PUSH_ENDPOINT_MAX)),
});

export const PushDeviceStatusSchema = v.object({ registered: v.boolean() });
export type PushDeviceStatus = v.InferOutput<typeof PushDeviceStatusSchema>;

export const PushPreferencesSchema = v.strictObject({
  grocery_added: v.boolean(),
  todo_due: v.boolean(),
});
export type PushPreferences = v.InferOutput<typeof PushPreferencesSchema>;

export const PushPreferencesInputSchema = v.strictObject({
  grocery_added: v.optional(v.boolean()),
  todo_due: v.optional(v.boolean()),
});
export type PushPreferencesInput = v.InferOutput<typeof PushPreferencesInputSchema>;

export const VapidPublicKeyResponseSchema = v.object({ publicKey: v.string() });

export const PushMessageSchema = v.object({
  title: v.pipe(v.string(), v.maxLength(120)),
  body: v.pipe(v.string(), v.maxLength(400)),
  tag: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,32}$/)),
  url: v.pipe(v.string(), v.maxLength(200), v.regex(/^\/(?![/\\])[^\s\\]*$/)),
});
export type PushMessage = v.InferOutput<typeof PushMessageSchema>;
