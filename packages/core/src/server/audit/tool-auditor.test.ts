import { describe, expect, test } from "bun:test";
import { parseUserId } from "../../shared/index.ts";
import { withTestAuth } from "../test/index.ts";
import { createAuditRecorder } from "./recorder.ts";
import { auditLog } from "./schema.ts";
import { createToolAuditor } from "./tool-auditor.ts";

const actor = parseUserId("user_123");

describe("tool auditor", () => {
  test("record writes an mcp entry for the actor", async () => {
    await withTestAuth({}, async ({ db }) => {
      const auditor = createToolAuditor({ audit: createAuditRecorder(db), actor, app: "todo" });
      await auditor.record("todo__list_projects", { count: 2 });
      const rows = await db.select().from(auditLog);
      expect(rows.map((r) => [r.userId, r.action, r.via, r.metadataJson])).toEqual([
        [actor, "todo__list_projects", "mcp", JSON.stringify({ count: 2 })],
      ]);
    });
  });

  test("failure returns text, the typed error as structured content, and audits the error kind", async () => {
    await withTestAuth({}, async ({ db }) => {
      const auditor = createToolAuditor({ audit: createAuditRecorder(db), actor, app: "todo" });
      const error = { kind: "task_not_found", id: "t1" } as const;
      const result = await auditor.failure("todo__complete_task", error, "No task.", {
        taskId: "t1",
      });
      expect(result).toEqual({
        content: [{ type: "text", text: "No task." }],
        structuredContent: { error },
        isError: true,
      });
      const rows = await db.select().from(auditLog);
      expect(rows.map((r) => [r.action, r.metadataJson])).toEqual([
        ["todo__complete_task", JSON.stringify({ taskId: "t1", error: "task_not_found" })],
      ]);
    });
  });

  test("an audit outage never fails the tool call", async () => {
    const auditor = createToolAuditor({
      audit: {
        record: async () => {
          throw new Error("audit unavailable");
        },
      },
      actor,
      app: "todo",
    });
    await expect(auditor.record("todo__list_projects", {})).resolves.toBeUndefined();
    const result = await auditor.failure("todo__remove_task", { kind: "x" }, "Nope.", {});
    expect(result.isError).toBe(true);
  });
});
