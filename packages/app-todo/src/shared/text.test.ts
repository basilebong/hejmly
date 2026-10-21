import { describe, expect, test } from "bun:test";
import { blankToNull } from "./text.ts";

describe("blankToNull", () => {
  test("empty and whitespace-only become null", () => {
    expect(blankToNull("")).toBeNull();
    expect(blankToNull(" \n\t ")).toBeNull();
    expect(blankToNull(null)).toBeNull();
  });

  test("real text is kept as is", () => {
    expect(blankToNull("Spring beds")).toBe("Spring beds");
  });
});
