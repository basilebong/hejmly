import { describe, expect, test } from "bun:test";
import { parseUserId } from "@hejmly/core/shared";
import { countTasks } from "./counts.ts";
import type { TaskStatus } from "./state.ts";

const done: TaskStatus = { kind: "done", doneAt: 1, doneBy: parseUserId("u1") };
const open: TaskStatus = { kind: "open" };

describe("countTasks", () => {
  test("splits open and done", () => {
    expect(countTasks([{ status: open }, { status: done }, { status: open }])).toEqual({
      open: 2,
      done: 1,
    });
  });

  test("an empty project has zero of each", () => {
    expect(countTasks([])).toEqual({ open: 0, done: 0 });
  });
});
