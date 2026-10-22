import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { parseAllowedEmails } from "./allowlist.ts";
import { checkEmailAllowed } from "./check-email-allowed.ts";

const apiErrorShape = v.object({
  statusCode: v.number(),
  body: v.object({ message: v.string() }),
});
const parseApiError = (raw: unknown): v.InferOutput<typeof apiErrorShape> =>
  v.parse(apiErrorShape, raw);

describe("checkEmailAllowed", () => {
  const allowed = parseAllowedEmails("basile@example.com,partner@example.com");

  test("returns undefined for an allowlisted email", () => {
    expect(checkEmailAllowed(allowed, "basile@example.com")).toBeUndefined();
  });

  test("matches case-insensitively", () => {
    expect(checkEmailAllowed(allowed, "Basile@Example.COM")).toBeUndefined();
  });

  test("throws a 403 APIError when the email is not on the allowlist", () => {
    let caught: unknown;
    try {
      checkEmailAllowed(allowed, "stranger@example.com");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const apiErr = parseApiError(caught);
    expect(apiErr.statusCode).toBe(403);
    expect(apiErr.body.message).toContain("stranger@example.com");
    expect(apiErr.body.message).toContain("allowlist");
  });

  // Better Auth's social callback only redirects to errorCallbackURL for an
  // APIError whose body carries a `code`; without one the browser is left on a
  // raw JSON 403 (better-auth/dist/api/routes/callback.mjs).
  test("carries a code so the OAuth callback redirects to the rejection screen", () => {
    let caught: unknown;
    try {
      checkEmailAllowed(allowed, "stranger@example.com");
    } catch (e) {
      caught = e;
    }
    expect(v.parse(v.object({ body: v.object({ code: v.string() }) }), caught).body.code).toBe(
      "EMAIL_NOT_ALLOWED",
    );
  });

  test("throws when the email is missing or empty", () => {
    expect(() => checkEmailAllowed(allowed, "")).toThrow();
    expect(() => checkEmailAllowed(allowed, undefined)).toThrow();
  });
});
