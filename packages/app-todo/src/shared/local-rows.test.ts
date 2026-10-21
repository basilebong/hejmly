import { describe, expect, test } from "bun:test";
import {
  isLocalId,
  type LocalCreateAttempt,
  localIdSeed,
  localRowStates,
  mergeServerRows,
  settleLocalRow,
  syncStateOf,
} from "./local-rows.ts";

type Row = { id: string; label: string };

const row = (id: string, label = id): Row => ({ id, label });

describe("local ids", () => {
  test("seeds are recognised as local, server ids are not", () => {
    expect(isLocalId(localIdSeed())).toBe(true);
    expect(isLocalId("01JABCDEF")).toBe(false);
  });

  test("seeds are unique", () => {
    expect(localIdSeed()).not.toBe(localIdSeed());
  });
});

describe("mergeServerRows", () => {
  test("keeps cached local rows the server does not know yet, at the requested end", () => {
    const local = row("tmp_a");
    const cached = [local, row("s1", "stale")];
    const server = [row("s1", "fresh"), row("s2")];
    expect(mergeServerRows(server, cached, { localAt: "start", hidden: new Set() })).toEqual([
      local,
      row("s1", "fresh"),
      row("s2"),
    ]);
    expect(mergeServerRows(server, cached, { localAt: "end", hidden: new Set() })).toEqual([
      row("s1", "fresh"),
      row("s2"),
      local,
    ]);
  });

  test("drops server rows that have a delete in flight", () => {
    expect(
      mergeServerRows([row("s1"), row("s2")], undefined, {
        localAt: "end",
        hidden: new Set(["s1"]),
      }),
    ).toEqual([row("s2")]);
  });

  test("server rows that were removed elsewhere disappear", () => {
    expect(
      mergeServerRows([row("s2")], [row("s1"), row("s2")], { localAt: "end", hidden: new Set() }),
    ).toEqual([row("s2")]);
  });
});

describe("settleLocalRow", () => {
  test("replaces the local row with the saved one in place", () => {
    const rows = [row("s1"), row("tmp_a"), row("s2")];
    expect(settleLocalRow(rows, "tmp_a", row("s9"), "end")).toEqual([
      row("s1"),
      row("s9"),
      row("s2"),
    ]);
  });

  test("drops the local row when the saved one is already listed (a replayed create)", () => {
    const rows = [row("tmp_a"), row("s9", "from refetch")];
    expect(settleLocalRow(rows, "tmp_a", row("s9", "saved"), "end")).toEqual([row("s9", "saved")]);
  });

  test("adds the saved row where new rows go when the local one is gone", () => {
    expect(settleLocalRow([row("s1")], "tmp_a", row("s9"), "end")).toEqual([row("s1"), row("s9")]);
    expect(settleLocalRow([row("s1")], "tmp_a", row("s9"), "start")).toEqual([
      row("s9"),
      row("s1"),
    ]);
  });
});

describe("localRowStates", () => {
  const attempt = (
    localId: string,
    status: LocalCreateAttempt["status"],
    submittedAt: number,
  ): LocalCreateAttempt => ({ localId, status, submittedAt });

  test("the latest attempt per local id decides its state", () => {
    const states = localRowStates([
      attempt("tmp_a", "error", 1),
      attempt("tmp_a", "pending", 2),
      attempt("tmp_b", "pending", 1),
      attempt("tmp_b", "error", 2),
    ]);
    expect(states.get("tmp_a")).toEqual({ kind: "queued" });
    expect(states.get("tmp_b")).toEqual({ kind: "error" });
  });

  test("a successful latest attempt leaves no state behind", () => {
    const states = localRowStates([attempt("tmp_a", "error", 1), attempt("tmp_a", "success", 2)]);
    expect(states.has("tmp_a")).toBe(false);
  });

  test("ignores attempts without a local id", () => {
    expect(localRowStates([{ localId: null, status: "pending", submittedAt: 1 }]).size).toBe(0);
  });
});

describe("syncStateOf", () => {
  const states = new Map([["tmp_a", { kind: "queued" } as const]]);

  test("server rows are synced", () => {
    expect(syncStateOf("s1", states)).toEqual({ kind: "synced" });
  });

  test("local rows report their attempt state", () => {
    expect(syncStateOf("tmp_a", states)).toEqual({ kind: "queued" });
  });

  test("a local row with no live attempt (e.g. after a reload) is retryable", () => {
    expect(syncStateOf("tmp_z", states)).toEqual({ kind: "error" });
  });
});
