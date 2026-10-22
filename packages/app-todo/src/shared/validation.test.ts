import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { CreateTaskInputSchema, UpdateTaskInputSchema } from "./validation.ts";

describe("CreateTaskInputSchema", () => {
  test("accepts an optional due date and assignee", () => {
    const r = v.safeParse(CreateTaskInputSchema, {
      title: "Dig",
      dueOn: "2026-10-31",
      assigneeId: "u_anna",
    });
    expect(r.success).toBe(true);
  });

  test("rejects an impossible due date and an over-long assignee id", () => {
    expect(v.safeParse(CreateTaskInputSchema, { title: "Dig", dueOn: "2026-02-30" }).success).toBe(
      false,
    );
    expect(
      v.safeParse(CreateTaskInputSchema, { title: "Dig", assigneeId: "u".repeat(65) }).success,
    ).toBe(false);
  });
});

describe("UpdateTaskInputSchema", () => {
  test("accepts clearing the due date or the assignee on its own", () => {
    expect(v.safeParse(UpdateTaskInputSchema, { dueOn: null }).success).toBe(true);
    expect(v.safeParse(UpdateTaskInputSchema, { assigneeId: null }).success).toBe(true);
  });

  test("rejects an empty patch", () => {
    expect(v.safeParse(UpdateTaskInputSchema, {}).success).toBe(false);
  });
});
