import { describe, expect, test } from "bun:test";
import { mergePreferences } from "./push-api.ts";

describe("mergePreferences", () => {
  test("changes only the topics in the change", () => {
    expect(mergePreferences({ grocery_added: true }, { grocery_added: false })).toEqual({
      grocery_added: false,
    });
    expect(mergePreferences({ grocery_added: false }, {})).toEqual({ grocery_added: false });
  });
});
