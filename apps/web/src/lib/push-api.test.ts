import { describe, expect, test } from "bun:test";
import {
  mergePreferences,
  PushApiError,
  requestFailureOf,
  rollbackPreferences,
} from "./push-api.ts";

describe("mergePreferences", () => {
  test("changes only the topics in the change", () => {
    const all = { grocery_added: true, todo_due: true };
    expect(mergePreferences(all, { grocery_added: false })).toEqual({
      grocery_added: false,
      todo_due: true,
    });
    expect(mergePreferences(all, { todo_due: false })).toEqual({
      grocery_added: true,
      todo_due: false,
    });
    expect(mergePreferences(all, {})).toEqual(all);
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

describe("rollbackPreferences", () => {
  test("restores only the topics of the failed change, keeping newer changes to others", () => {
    const before = { grocery_added: true, todo_due: true };
    const now = { grocery_added: false, todo_due: false };
    expect(rollbackPreferences(now, before, { grocery_added: false })).toEqual({
      grocery_added: true,
      todo_due: false,
    });
  });
});
