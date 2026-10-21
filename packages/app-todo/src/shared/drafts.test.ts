import { describe, expect, test } from "bun:test";
import { diffProjectDraft, diffTaskDraft, parseProjectDraft, parseTaskDraft } from "./drafts.ts";

describe("parseProjectDraft", () => {
  test("trims and drops an empty description", () => {
    expect(parseProjectDraft({ name: "  Garden  ", description: "   " })).toEqual({
      kind: "ok",
      value: { name: "Garden" },
    });
  });

  test("keeps a trimmed description", () => {
    expect(parseProjectDraft({ name: "Garden", description: " Spring beds " })).toEqual({
      kind: "ok",
      value: { name: "Garden", description: "Spring beds" },
    });
  });

  test("rejects a blank name with the schema message", () => {
    expect(parseProjectDraft({ name: "   ", description: "" })).toEqual({
      kind: "error",
      message: "Project name can't be empty",
    });
  });

  test("rejects an over-long name", () => {
    const r = parseProjectDraft({ name: "x".repeat(81), description: "" });
    expect(r).toEqual({ kind: "error", message: "Project name is too long" });
  });
});

describe("diffProjectDraft", () => {
  const initial = { name: "Garden", description: "Spring beds" };

  test("no edits is unchanged", () => {
    expect(diffProjectDraft(initial, { name: " Garden ", description: "Spring beds " })).toEqual({
      kind: "unchanged",
    });
  });

  test("only changed fields are sent", () => {
    expect(diffProjectDraft(initial, { name: "Yard", description: "Spring beds" })).toEqual({
      kind: "ok",
      value: { name: "Yard" },
    });
  });

  test("clearing the description sends null", () => {
    expect(diffProjectDraft(initial, { name: "Garden", description: "  " })).toEqual({
      kind: "ok",
      value: { description: null },
    });
  });

  test("a null initial description compares equal to an empty draft", () => {
    expect(
      diffProjectDraft({ name: "Garden", description: null }, { name: "Garden", description: "" }),
    ).toEqual({ kind: "unchanged" });
  });

  test("invalid edits report the error even when other fields changed", () => {
    expect(diffProjectDraft(initial, { name: "", description: "New" })).toEqual({
      kind: "error",
      message: "Project name can't be empty",
    });
  });
});

describe("parseTaskDraft", () => {
  test("trims and drops empty notes", () => {
    expect(parseTaskDraft({ title: " Buy seeds ", notes: "" })).toEqual({
      kind: "ok",
      value: { title: "Buy seeds" },
    });
  });

  test("rejects a blank title", () => {
    expect(parseTaskDraft({ title: "", notes: "x" })).toEqual({
      kind: "error",
      message: "Task can't be empty",
    });
  });

  test("rejects over-long notes", () => {
    const r = parseTaskDraft({ title: "Buy seeds", notes: "x".repeat(1001) });
    expect(r).toEqual({ kind: "error", message: "Notes are too long" });
  });
});

describe("diffTaskDraft", () => {
  test("changing title and notes sends both", () => {
    expect(
      diffTaskDraft({ title: "Buy seeds", notes: null }, { title: "Sow seeds", notes: "Tomato" }),
    ).toEqual({ kind: "ok", value: { title: "Sow seeds", notes: "Tomato" } });
  });

  test("no edits is unchanged", () => {
    expect(
      diffTaskDraft({ title: "Buy seeds", notes: "a" }, { title: "Buy seeds", notes: "a" }),
    ).toEqual({ kind: "unchanged" });
  });
});
