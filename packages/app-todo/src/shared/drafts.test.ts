import { describe, expect, test } from "bun:test";
import { parseUserId } from "@hejmly/core/shared";
import { diffProjectDraft, diffTaskDraft, parseProjectDraft, parseTaskDraft } from "./drafts.ts";
import { parseDueDate } from "./due.ts";

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

const anna = parseUserId("u_anna");
const ben = parseUserId("u_ben");
const draft = (fields: Partial<Parameters<typeof parseTaskDraft>[0]>) => ({
  title: "Buy seeds",
  notes: "",
  dueOn: "",
  assigneeId: null,
  ...fields,
});

describe("parseTaskDraft", () => {
  test("trims and drops empty notes, due date and assignee", () => {
    expect(parseTaskDraft(draft({ title: " Buy seeds " }))).toEqual({
      kind: "ok",
      value: { title: "Buy seeds" },
    });
  });

  test("keeps a due date and an assignee", () => {
    expect(parseTaskDraft(draft({ dueOn: "2026-10-31", assigneeId: anna }))).toEqual({
      kind: "ok",
      value: { title: "Buy seeds", dueOn: parseDueDate("2026-10-31"), assigneeId: anna },
    });
  });

  test("rejects a blank title", () => {
    expect(parseTaskDraft(draft({ title: "", notes: "x" }))).toEqual({
      kind: "error",
      message: "Task can't be empty",
    });
  });

  test("rejects over-long notes", () => {
    const r = parseTaskDraft(draft({ notes: "x".repeat(1001) }));
    expect(r).toEqual({ kind: "error", message: "Notes are too long" });
  });

  test("rejects a date that doesn't exist", () => {
    expect(parseTaskDraft(draft({ dueOn: "2026-02-30" }))).toEqual({
      kind: "error",
      message: "That date doesn't exist",
    });
  });
});

describe("diffTaskDraft", () => {
  const initial = {
    title: "Buy seeds",
    notes: null,
    dueOn: parseDueDate("2026-10-31"),
    assigneeId: anna,
  };

  test("changing title and notes sends both", () => {
    expect(
      diffTaskDraft(
        initial,
        draft({ title: "Sow seeds", notes: "Tomato", dueOn: "2026-10-31", assigneeId: anna }),
      ),
    ).toEqual({ kind: "ok", value: { title: "Sow seeds", notes: "Tomato" } });
  });

  test("no edits is unchanged", () => {
    expect(diffTaskDraft(initial, draft({ dueOn: "2026-10-31", assigneeId: anna }))).toEqual({
      kind: "unchanged",
    });
  });

  test("clearing the due date and the assignee sends null", () => {
    expect(diffTaskDraft(initial, draft({}))).toEqual({
      kind: "ok",
      value: { dueOn: null, assigneeId: null },
    });
  });

  test("moving the due date and reassigning sends only those", () => {
    expect(diffTaskDraft(initial, draft({ dueOn: "2026-11-02", assigneeId: ben }))).toEqual({
      kind: "ok",
      value: { dueOn: parseDueDate("2026-11-02"), assigneeId: ben },
    });
  });
});
