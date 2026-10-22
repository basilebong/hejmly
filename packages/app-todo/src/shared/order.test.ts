import { describe, expect, test } from "bun:test";
import { parseDueDate } from "./due.ts";
import { orderOpenTasks } from "./order.ts";

const t = (id: string, dueOn: string | null) => ({
  id,
  dueOn: dueOn === null ? null : parseDueDate(dueOn),
});

describe("orderOpenTasks", () => {
  test("puts dated tasks first, soonest first, then undated in their original order", () => {
    const tasks = [
      t("a", null),
      t("b", "2026-11-03"),
      t("c", null),
      t("d", "2026-10-20"),
      t("e", "2026-11-03"),
    ];
    expect(orderOpenTasks(tasks).map((x) => x.id)).toEqual(["d", "b", "e", "a", "c"]);
  });

  test("does not mutate its input", () => {
    const tasks = [t("a", null), t("b", "2026-10-20")];
    orderOpenTasks(tasks);
    expect(tasks.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
