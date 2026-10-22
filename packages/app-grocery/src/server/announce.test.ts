import { describe, expect, test } from "bun:test";
import { parseUserId } from "@hejmly/core/shared";
import { announcementTag, describeAdditions, windowOf } from "./announce.ts";

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

describe("announcementTag", () => {
  const anna = parseUserId("u_anna");
  const basile = parseUserId("u_basile");

  test("is a valid push Topic, stable for one person and window", async () => {
    const tag = await announcementTag(anna, 29_000_000);
    expect(tag).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(await announcementTag(anna, 29_000_000)).toBe(tag);
  });

  test("differs between people and between windows, so one never replaces another", async () => {
    const tags = new Set([
      await announcementTag(anna, 29_000_000),
      await announcementTag(basile, 29_000_000),
      await announcementTag(anna, 29_000_001),
    ]);
    expect(tags.size).toBe(3);
  });

  test("fits a long user id and a short test window's large index", async () => {
    const long = parseUserId("x".repeat(64));
    expect(await announcementTag(long, 9_999_999_999, 99)).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  });

  test("a follow-up announcement for the same window does not replace the first", async () => {
    const first = await announcementTag(anna, 29_000_000);
    const second = await announcementTag(anna, 29_000_000, 1);
    expect(second).not.toBe(first);
    expect(await announcementTag(anna, 29_000_000, 0)).toBe(first);
  });
});
