import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import {
  PushMessageSchema,
  PushPreferencesInputSchema,
  PushSubscriptionInputSchema,
} from "./push.ts";

const p256dh = `B${"A".repeat(86)}`;
const auth = "A".repeat(22);
const subscription = (overrides: Record<string, unknown> = {}) => ({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc",
  keys: { p256dh, auth },
  ...overrides,
});

describe("PushSubscriptionInputSchema", () => {
  test("accepts what PushSubscription.toJSON() produces", () => {
    expect(v.safeParse(PushSubscriptionInputSchema, subscription()).success).toBe(true);
    expect(
      v.safeParse(PushSubscriptionInputSchema, subscription({ expirationTime: null })).success,
    ).toBe(true);
  });

  test("rejects keys that are not base64url of the right size", () => {
    for (const keys of [
      { p256dh: "short", auth },
      { p256dh, auth: "A".repeat(40) },
      { p256dh: `${p256dh.slice(0, -1)}+`, auth },
    ]) {
      expect(v.safeParse(PushSubscriptionInputSchema, subscription({ keys })).success).toBe(false);
    }
  });

  test("rejects an endpoint that is not a URL or is unreasonably long", () => {
    for (const endpoint of ["not a url", `https://fcm.googleapis.com/${"a".repeat(2100)}`]) {
      expect(v.safeParse(PushSubscriptionInputSchema, subscription({ endpoint })).success).toBe(
        false,
      );
    }
  });
});

describe("PushPreferencesInputSchema", () => {
  test("takes a boolean per known topic and rejects unknown topics", () => {
    expect(v.safeParse(PushPreferencesInputSchema, { grocery_added: false }).success).toBe(true);
    expect(v.safeParse(PushPreferencesInputSchema, { grocery_added: "no" }).success).toBe(false);
    expect(v.safeParse(PushPreferencesInputSchema, { lottery: true }).success).toBe(false);
  });
});

describe("PushMessageSchema", () => {
  test("only allows in-app paths as the click target", () => {
    const message = { title: "Grocery list", body: "Anna added Milk", tag: "grocery-added" };
    expect(v.safeParse(PushMessageSchema, { ...message, url: "/grocery" }).success).toBe(true);
    for (const url of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
      "grocery",
    ]) {
      expect(v.safeParse(PushMessageSchema, { ...message, url }).success).toBe(false);
    }
  });
});
