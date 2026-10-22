import { describe, expect, test } from "bun:test";
import { parseEnv, parseRuntimeEnv } from "./env.ts";

describe("parseEnv", () => {
  test("applies defaults when env is empty", () => {
    const env = parseEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.CI).toBe(false);
    expect(env.E2E_BASE_URL).toBe("http://localhost:5173");
    expect(env.BETTER_AUTH_SECRET).toBeUndefined();
    expect(env.BETTER_AUTH_URL).toBeUndefined();
    expect(env.GOOGLE_ID).toBeUndefined();
    expect(env.GOOGLE_SECRET).toBeUndefined();
    expect(env.MCP_HOST).toBeUndefined();
    expect(env.DATABASE_PATH).toBeUndefined();
    expect(env.HEJMLY_ALLOWED_EMAILS).toBeUndefined();
  });

  test("HEJMLY_ALLOWED_EMAILS passes through as a raw string", () => {
    const env = parseEnv({ HEJMLY_ALLOWED_EMAILS: "a@example.com,b@example.com" });
    expect(env.HEJMLY_ALLOWED_EMAILS).toBe("a@example.com,b@example.com");
  });

  test("parses PORT as integer", () => {
    expect(parseEnv({ PORT: "8080" }).PORT).toBe(8080);
  });

  test("rejects non-numeric PORT", () => {
    expect(() => parseEnv({ PORT: "abc" })).toThrow();
  });

  test("rejects PORT outside 1-65535", () => {
    expect(() => parseEnv({ PORT: "0" })).toThrow();
    expect(() => parseEnv({ PORT: "65536" })).toThrow();
  });

  test("rejects fractional PORT", () => {
    expect(() => parseEnv({ PORT: "3000.5" })).toThrow();
  });

  test("CI truthiness", () => {
    expect(parseEnv({ CI: "true" }).CI).toBe(true);
    expect(parseEnv({ CI: "1" }).CI).toBe(true);
    expect(parseEnv({ CI: "false" }).CI).toBe(false);
    expect(parseEnv({ CI: "0" }).CI).toBe(false);
    expect(parseEnv({ CI: "" }).CI).toBe(false);
  });

  test("E2E_BASE_URL must be a URL", () => {
    expect(parseEnv({ E2E_BASE_URL: "https://staging.example.com" }).E2E_BASE_URL).toBe(
      "https://staging.example.com",
    );
    expect(() => parseEnv({ E2E_BASE_URL: "not-a-url" })).toThrow();
  });

  test("BETTER_AUTH_SECRET must be ≥32 chars when present", () => {
    expect(() => parseEnv({ BETTER_AUTH_SECRET: "short" })).toThrow();
    const ok = "a".repeat(32);
    expect(parseEnv({ BETTER_AUTH_SECRET: ok }).BETTER_AUTH_SECRET).toBe(ok);
  });

  test("BETTER_AUTH_URL must be a URL when present", () => {
    expect(() => parseEnv({ BETTER_AUTH_URL: "not-a-url" })).toThrow();
    expect(parseEnv({ BETTER_AUTH_URL: "https://app.example.com" }).BETTER_AUTH_URL).toBe(
      "https://app.example.com",
    );
  });

  test("MCP_HOST / GOOGLE_ID / DATABASE_PATH reject empty strings", () => {
    expect(() => parseEnv({ MCP_HOST: "" })).toThrow();
    expect(() => parseEnv({ GOOGLE_ID: "" })).toThrow();
    expect(() => parseEnv({ DATABASE_PATH: "" })).toThrow();
  });
});

describe("HEJMLY_TIMEZONE", () => {
  const runtime = {
    BETTER_AUTH_URL: "https://hejmly.example",
    BETTER_AUTH_SECRET: "x".repeat(32),
    GOOGLE_ID: "id",
    GOOGLE_SECRET: "secret",
    DATABASE_PATH: "/data/app.db",
    HEJMLY_ALLOWED_EMAILS: "a@example.com",
  };

  test("defaults to UTC", () => {
    expect(parseRuntimeEnv(runtime).HEJMLY_TIMEZONE).toBe("UTC");
  });

  test("accepts an IANA zone and refuses a made-up one", () => {
    expect(parseRuntimeEnv({ ...runtime, HEJMLY_TIMEZONE: "Europe/Berlin" }).HEJMLY_TIMEZONE).toBe(
      "Europe/Berlin",
    );
    expect(() => parseRuntimeEnv({ ...runtime, HEJMLY_TIMEZONE: "Mars/Olympus" })).toThrow();
  });
});
