import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import {
  addDays,
  clockInZone,
  DueDateSchema,
  dueLabel,
  dueState,
  localDueDate,
  parseDueDate,
} from "./due.ts";

const d = parseDueDate;

describe("DueDateSchema", () => {
  test("accepts a calendar date", () => {
    expect(v.safeParse(DueDateSchema, "2026-10-31").success).toBe(true);
    expect(v.safeParse(DueDateSchema, "2028-02-29").success).toBe(true);
  });

  test("rejects dates that don't exist", () => {
    expect(v.safeParse(DueDateSchema, "2026-02-29").success).toBe(false);
    expect(v.safeParse(DueDateSchema, "2026-04-31").success).toBe(false);
  });

  test("rejects anything but YYYY-MM-DD", () => {
    for (const raw of ["2026-1-5", "31.10.2026", "2026-10-31T00:00:00Z", "", 20261031]) {
      expect(v.safeParse(DueDateSchema, raw).success).toBe(false);
    }
  });
});

describe("localDueDate", () => {
  test("uses the local calendar day, not UTC", () => {
    expect(localDueDate(new Date(2026, 9, 22, 23, 59))).toBe(d("2026-10-22"));
    expect(localDueDate(new Date(2026, 0, 1, 0, 0))).toBe(d("2026-01-01"));
  });
});

describe("addDays", () => {
  test("crosses month, year and DST boundaries by whole days", () => {
    expect(addDays(d("2026-10-31"), 1)).toBe(d("2026-11-01"));
    expect(addDays(d("2026-12-31"), 1)).toBe(d("2027-01-01"));
    expect(addDays(d("2026-03-28"), 2)).toBe(d("2026-03-30"));
    expect(addDays(d("2026-03-01"), -1)).toBe(d("2026-02-28"));
  });
});

describe("dueState", () => {
  const today = d("2026-10-22");

  test("classifies relative to today", () => {
    expect(dueState(d("2026-10-20"), today)).toEqual({ kind: "overdue", days: 2 });
    expect(dueState(d("2026-10-22"), today)).toEqual({ kind: "today" });
    expect(dueState(d("2026-10-23"), today)).toEqual({ kind: "tomorrow" });
    expect(dueState(d("2026-11-05"), today)).toEqual({ kind: "upcoming", days: 14 });
  });

  test("counts whole days across a DST change", () => {
    expect(dueState(d("2026-03-27"), d("2026-03-30"))).toEqual({ kind: "overdue", days: 3 });
  });
});

describe("dueLabel", () => {
  const today = d("2026-10-22");
  const label = (due: string) => dueLabel(d(due), today, "en-GB");

  test("names the near days", () => {
    expect(label("2026-10-21")).toBe("Yesterday");
    expect(label("2026-10-22")).toBe("Today");
    expect(label("2026-10-23")).toBe("Tomorrow");
  });

  test("uses the weekday within the coming week", () => {
    expect(label("2026-10-26")).toBe("Monday");
    expect(label("2026-10-28")).toBe("Wednesday");
  });

  test("uses a short date further out or further back", () => {
    expect(label("2026-10-29")).toBe("Thu 29 Oct");
    expect(label("2026-10-15")).toBe("Thu 15 Oct");
  });

  test("adds the year when it differs", () => {
    expect(label("2027-01-04")).toBe("Mon, 4 Jan 2027");
  });
});

describe("clockInZone", () => {
  test("reads the calendar date and hour of a moment in a time zone", () => {
    const at = new Date("2026-10-22T06:30:00Z");
    expect(clockInZone(at, "UTC")).toEqual({ date: d("2026-10-22"), hour: 6 });
    expect(clockInZone(at, "Europe/Berlin")).toEqual({ date: d("2026-10-22"), hour: 8 });
    expect(clockInZone(at, "America/Los_Angeles")).toEqual({ date: d("2026-10-21"), hour: 23 });
  });

  test("crosses midnight into the zone's next day", () => {
    expect(clockInZone(new Date("2026-10-22T23:30:00Z"), "Europe/Berlin")).toEqual({
      date: d("2026-10-23"),
      hour: 1,
    });
  });

  test("follows daylight saving time", () => {
    expect(clockInZone(new Date("2026-10-24T06:30:00Z"), "Europe/Berlin")).toEqual({
      date: d("2026-10-24"),
      hour: 8,
    });
    expect(clockInZone(new Date("2026-10-25T06:30:00Z"), "Europe/Berlin")).toEqual({
      date: d("2026-10-25"),
      hour: 7,
    });
  });

  test("midnight is hour 0, not 24", () => {
    expect(clockInZone(new Date("2026-10-22T22:00:00Z"), "Europe/Berlin").hour).toBe(0);
  });
});
