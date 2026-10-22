import { describe, expect, test } from "bun:test";
import { mergePreferences, PushApiError, requestFailureOf } from "./push-api.ts";

describe("mergePreferences", () => {
  test("changes only the topics in the change", () => {
    expect(mergePreferences({ grocery_added: true }, { grocery_added: false })).toEqual({
      grocery_added: false,
    });
    expect(mergePreferences({ grocery_added: false }, {})).toEqual({ grocery_added: false });
  });
});

describe("requestFailureOf", () => {
  test("offline wins over whatever the request threw", () => {
    expect(requestFailureOf(new TypeError("Failed to fetch"), false)).toEqual({ kind: "offline" });
    expect(requestFailureOf(new PushApiError(500, ""), false)).toEqual({ kind: "offline" });
  });

  test("maps the server's answers", () => {
    expect(requestFailureOf(new PushApiError(409, ""), true)).toEqual({
      kind: "too_many_devices",
    });
    expect(requestFailureOf(new PushApiError(422, ""), true)).toEqual({ kind: "browser" });
    expect(requestFailureOf(new PushApiError(503, ""), true)).toEqual({ kind: "server" });
    expect(requestFailureOf(new TypeError("Failed to fetch"), true)).toEqual({ kind: "server" });
  });
});
