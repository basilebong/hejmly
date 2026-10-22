import { describe, expect, test } from "bun:test";
import { parseUserId } from "@hejmly/core/shared";
import { assigneeLabels } from "./names.ts";

const person = (id: string, name: string) => ({
  assignee: { id: parseUserId(id), name, initial: "" },
});

describe("assigneeLabels", () => {
  test("uses first names when they are unique", () => {
    const labels = assigneeLabels([
      person("a", "Anna Keller"),
      person("b", "Basile"),
      { assignee: null },
    ]);
    expect([...labels]).toEqual([
      [parseUserId("a"), "Anna"],
      [parseUserId("b"), "Basile"],
    ]);
  });

  test("falls back to full names for people who share a first name", () => {
    const labels = assigneeLabels([
      person("a", "Anna Keller"),
      person("b", "Anna Weber"),
      person("a", "Anna Keller"),
      person("c", "Basile"),
    ]);
    expect(labels.get(parseUserId("a"))).toBe("Anna Keller");
    expect(labels.get(parseUserId("b"))).toBe("Anna Weber");
    expect(labels.get(parseUserId("c"))).toBe("Basile");
  });

  test("treats first names that differ only in case as the same", () => {
    const labels = assigneeLabels([person("a", "anna keller"), person("b", "Anna Weber")]);
    expect(labels.get(parseUserId("a"))).toBe("anna keller");
    expect(labels.get(parseUserId("b"))).toBe("Anna Weber");
  });
});
