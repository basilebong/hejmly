import { type AuditRecorder, createToolAuditor } from "@hejmly/core/server";
import type { UserId } from "@hejmly/core/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { match } from "ts-pattern";
import * as z from "zod";
import type { CleanupScheduler, GroceryAnnouncer, GroceryService } from "../server/index.ts";
import {
  type GroceryError,
  type GroceryItem,
  ID_MAX_LENGTH,
  parseGroceryItemId,
} from "../shared/index.ts";

const idInput = z.string().min(1).max(ID_MAX_LENGTH);
export type GroceryToolDeps = {
  service: GroceryService;
  actor: UserId;
  audit: AuditRecorder;
  cleanup: CleanupScheduler;
  announcer: GroceryAnnouncer;
};

const safely = async (label: string, p: Promise<void>): Promise<void> => {
  try {
    await p;
  } catch (e) {
    console.error(`grocery ${label} failed`, e);
  }
};

const itemText = (item: GroceryItem): string => {
  const status = item.status.kind === "purchased" ? "purchased" : "pending";
  const description = item.description === null ? "" : ` — ${item.description}`;
  return `${item.name}${description} [${status}, added by ${item.addedBy.name}]`;
};

const errorText = (error: GroceryError): string =>
  match(error)
    .with({ kind: "not_found" }, (e) => `No grocery item found with id "${e.id}".`)
    .with({ kind: "invalid_input" }, (e) => e.message)
    .with({ kind: "already_in_state" }, (e) => `Item is already ${e.state}.`)
    .exhaustive();

const itemResult = (text: string, item: GroceryItem) => ({
  content: [{ type: "text" as const, text }],
  structuredContent: { item },
});

export const registerGroceryTools = (server: McpServer, deps: GroceryToolDeps): void => {
  const { service, actor, audit, cleanup, announcer } = deps;
  const auditor = createToolAuditor({ audit, actor, app: "grocery" });

  server.registerTool(
    "grocery__list_items",
    {
      title: "List grocery items",
      description: "List items on the grocery list, optionally filtered by status.",
      inputSchema: { status: z.enum(["pending", "purchased", "all"]).optional() },
    },
    async ({ status }) => {
      const all = await service.list();
      const items =
        status === undefined || status === "all"
          ? all
          : all.filter((item) => item.status.kind === status);
      await auditor.record("grocery__list_items", { status: status ?? "all", count: items.length });
      const text =
        items.length === 0 ? "The grocery list is empty." : items.map(itemText).join("\n");
      return { content: [{ type: "text" as const, text }], structuredContent: { items } };
    },
  );

  server.registerTool(
    "grocery__add_item",
    {
      title: "Add grocery item",
      description: "Add a new item to the grocery list.",
      inputSchema: {
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(280).optional(),
      },
    },
    async ({ name, description }) => {
      const result = await service.create({ name, description }, actor);
      if (result.kind === "err")
        return auditor.failure("grocery__add_item", result.error, errorText(result.error), {});
      await auditor.record("grocery__add_item", { itemId: result.value.id });
      await safely("announce", announcer.itemAdded(result.value));
      return itemResult(`Added "${result.value.name}" to the grocery list.`, result.value);
    },
  );

  server.registerTool(
    "grocery__mark_purchased",
    {
      title: "Mark grocery item purchased",
      description: "Mark a grocery item as purchased.",
      inputSchema: { itemId: idInput },
    },
    async ({ itemId }) => {
      const result = await service.markPurchased(parseGroceryItemId(itemId), actor);
      if (result.kind === "err")
        return auditor.failure("grocery__mark_purchased", result.error, errorText(result.error), {
          itemId,
        });
      await auditor.record("grocery__mark_purchased", { itemId: result.value.id });
      await safely("cleanup schedule", cleanup.schedule(result.value.id));
      return itemResult(`Marked "${result.value.name}" as purchased.`, result.value);
    },
  );

  server.registerTool(
    "grocery__mark_pending",
    {
      title: "Mark grocery item pending",
      description: "Move a purchased grocery item back to pending.",
      inputSchema: { itemId: idInput },
    },
    async ({ itemId }) => {
      const result = await service.markPending(parseGroceryItemId(itemId));
      if (result.kind === "err")
        return auditor.failure("grocery__mark_pending", result.error, errorText(result.error), {
          itemId,
        });
      await auditor.record("grocery__mark_pending", { itemId: result.value.id });
      await safely("cleanup cancel", cleanup.cancel(result.value.id));
      return itemResult(`Moved "${result.value.name}" back to pending.`, result.value);
    },
  );

  server.registerTool(
    "grocery__update_item",
    {
      title: "Update grocery item",
      description: "Update the name or description of a grocery item.",
      inputSchema: {
        itemId: idInput,
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(280).nullable().optional(),
      },
    },
    async ({ itemId, name, description }) => {
      const result = await service.update(parseGroceryItemId(itemId), { name, description });
      if (result.kind === "err")
        return auditor.failure("grocery__update_item", result.error, errorText(result.error), {
          itemId,
        });
      await auditor.record("grocery__update_item", { itemId: result.value.id });
      return itemResult(`Updated "${result.value.name}".`, result.value);
    },
  );

  server.registerTool(
    "grocery__remove_item",
    {
      title: "Remove grocery item",
      description: "Permanently remove an item from the grocery list.",
      inputSchema: { itemId: idInput },
    },
    async ({ itemId }) => {
      const result = await service.remove(parseGroceryItemId(itemId));
      if (result.kind === "err")
        return auditor.failure("grocery__remove_item", result.error, errorText(result.error), {
          itemId,
        });
      await auditor.record("grocery__remove_item", { itemId: result.value.id });
      await safely("cleanup cancel", cleanup.cancel(result.value.id));
      return {
        content: [{ type: "text" as const, text: `Removed item ${result.value.id}.` }],
        structuredContent: { id: result.value.id },
      };
    },
  );
};
