import { describe, expect, test } from "bun:test";
import { isErr, isOk, parseUserId } from "@hejmly/core/shared";
import { isDone, type TaskStatus, transition } from "./state.ts";

const U1 = parseUserId("u1");
const U2 = parseUserId("u2");

const OPEN: TaskStatus = { kind: "open" };
const DONE: TaskStatus = { kind: "done", doneAt: 1000, doneBy: U1 };

describe("transition", () => {
  test("open → done records who and when", () => {
    const r = transition(OPEN, { kind: "complete", by: U2, at: 2000 });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toEqual({ kind: "done", doneAt: 2000, doneBy: U2 });
  });

  test("done → open clears completion metadata", () => {
    const r = transition(DONE, { kind: "reopen" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toEqual({ kind: "open" });
  });

  test("done → done is rejected and does not overwrite who finished it", () => {
    const r = transition(DONE, { kind: "complete", by: U2, at: 3000 });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error).toEqual({ kind: "already_in_state", state: "done" });
  });

  test("open → open is rejected", () => {
    const r = transition(OPEN, { kind: "reopen" });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error).toEqual({ kind: "already_in_state", state: "open" });
  });
});

describe("isDone", () => {
  test("narrows only the done variant", () => {
    expect(isDone(DONE)).toBe(true);
    expect(isDone(OPEN)).toBe(false);
  });
});
