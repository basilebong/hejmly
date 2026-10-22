import { describe, expect, test } from "bun:test";
import { describeAdditions, windowOf } from "./announce.ts";

describe("describeAdditions", () => {
  test("names up to three items, then counts the rest", () => {
    expect(describeAdditions("Anna", ["Milk"])).toBe("Anna added Milk");
    expect(describeAdditions("Anna", ["Milk", "Eggs"])).toBe("Anna added Milk and Eggs");
    expect(describeAdditions("Anna", ["Milk", "Eggs", "Bread"])).toBe(
      "Anna added Milk, Eggs and Bread",
    );
    expect(describeAdditions("Anna", ["Milk", "Eggs", "Bread", "Jam", "Tea"])).toBe(
      "Anna added Milk, Eggs, Bread and 2 more",
    );
  });

  test("keeps a long item name from blowing up the notification", () => {
    const body = describeAdditions("Anna", ["x".repeat(500)]);
    expect(body.length).toBeLessThanOrEqual(400);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("windowOf", () => {
  test("puts every moment in exactly one window", () => {
    expect(windowOf(0, 60_000)).toEqual({ index: 0, start: 0, end: 60_000 });
    expect(windowOf(59_999, 60_000)).toEqual({ index: 0, start: 0, end: 60_000 });
    expect(windowOf(60_000, 60_000)).toEqual({ index: 1, start: 60_000, end: 120_000 });
  });
});
