import { describe, expect, test } from "bun:test";
import {
  cancelTimer,
  elapsedFraction,
  hasActiveTimer,
  isDone,
  remainingMs,
  startTimer,
  type TimerMap,
  viewTimer,
} from "./timers.ts";

const EMPTY: TimerMap = {};
const T0 = 1_000_000;
const PASTA = "pasta";

describe("startTimer", () => {
  test("seeds a timer that ends after the given minutes", () => {
    const timers = startTimer(EMPTY, "pasta", "Rigatoni", 11, T0);
    const timer = timers[PASTA];
    expect(timer).toBeDefined();
    if (timer === undefined) return;
    expect(timer.label).toBe("Rigatoni");
    expect(timer.durationMs).toBe(11 * 60_000);
    expect(timer.endsAt).toBe(T0 + 11 * 60_000);
  });

  test("does not mutate the input map", () => {
    startTimer(EMPTY, "pasta", "Rigatoni", 11, T0);
    expect(Object.keys(EMPTY)).toHaveLength(0);
  });

  test("restarting the same id replaces the timer", () => {
    const once = startTimer(EMPTY, "pasta", "Rigatoni", 11, T0);
    const twice = startTimer(once, "pasta", "Rigatoni", 5, T0 + 1000);
    expect(twice[PASTA]?.endsAt).toBe(T0 + 1000 + 5 * 60_000);
  });
});

describe("cancelTimer", () => {
  test("removes the timer", () => {
    const timers = startTimer(EMPTY, "pasta", "Rigatoni", 11, T0);
    expect(cancelTimer(timers, "pasta")).toEqual({});
  });

  test("returns the same reference when the id is absent", () => {
    const timers = startTimer(EMPTY, "pasta", "Rigatoni", 11, T0);
    expect(cancelTimer(timers, "missing")).toBe(timers);
  });
});

describe("remainingMs / isDone / elapsedFraction", () => {
  const timers = startTimer(EMPTY, "pasta", "Rigatoni", 10, T0);
  const timer = timers[PASTA];
  if (timer === undefined) throw new Error("seed failed");

  test("counts down and clamps at zero", () => {
    expect(remainingMs(timer, T0)).toBe(10 * 60_000);
    expect(remainingMs(timer, T0 + 4 * 60_000)).toBe(6 * 60_000);
    expect(remainingMs(timer, T0 + 11 * 60_000)).toBe(0);
  });

  test("isDone flips at the end", () => {
    expect(isDone(timer, T0 + 9 * 60_000)).toBe(false);
    expect(isDone(timer, T0 + 10 * 60_000)).toBe(true);
  });

  test("elapsedFraction runs 0 → 1", () => {
    expect(elapsedFraction(timer, T0)).toBe(0);
    expect(elapsedFraction(timer, T0 + 5 * 60_000)).toBe(0.5);
    expect(elapsedFraction(timer, T0 + 20 * 60_000)).toBe(1);
  });
});

describe("hasActiveTimer", () => {
  test("false when empty", () => {
    expect(hasActiveTimer(EMPTY, T0)).toBe(false);
  });

  test("true while any timer is still running", () => {
    const timers = startTimer(EMPTY, "pasta", "Rigatoni", 10, T0);
    expect(hasActiveTimer(timers, T0 + 60_000)).toBe(true);
    expect(hasActiveTimer(timers, T0 + 10 * 60_000)).toBe(false);
  });
});

describe("viewTimer", () => {
  test("idle when there is no timer", () => {
    expect(viewTimer(undefined, T0)).toEqual({ kind: "idle" });
  });

  test("running carries remaining and fraction", () => {
    const timers = startTimer(EMPTY, "pasta", "Rigatoni", 10, T0);
    const view = viewTimer(timers[PASTA], T0 + 2 * 60_000);
    expect(view).toEqual({ kind: "running", remainingMs: 8 * 60_000, fraction: 0.2 });
  });

  test("done at the end", () => {
    const timers = startTimer(EMPTY, "pasta", "Rigatoni", 10, T0);
    expect(viewTimer(timers[PASTA], T0 + 10 * 60_000)).toEqual({ kind: "done" });
  });
});
