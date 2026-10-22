import * as v from "valibot";

declare const brand: unique symbol;
export type Brand<T, B> = T & { readonly [brand]: B };

export const UserIdSchema = v.pipe(v.string(), v.minLength(1), v.brand("UserId"));
export type UserId = v.InferOutput<typeof UserIdSchema>;
export const parseUserId = (raw: unknown): UserId => v.parse(UserIdSchema, raw);

export const OAuthConsentIdSchema = v.pipe(v.string(), v.minLength(1), v.brand("OAuthConsentId"));
export type OAuthConsentId = v.InferOutput<typeof OAuthConsentIdSchema>;
export const parseOAuthConsentId = (raw: unknown): OAuthConsentId =>
  v.parse(OAuthConsentIdSchema, raw);

export const PushSubscriptionIdSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.brand("PushSubscriptionId"),
);
export type PushSubscriptionId = v.InferOutput<typeof PushSubscriptionIdSchema>;
export const parsePushSubscriptionId = (raw: unknown): PushSubscriptionId =>
  v.parse(PushSubscriptionIdSchema, raw);
