import { describe, expect, test } from "bun:test";
import type { Auth, Db } from "@hejmly/core/server";
import { createAuditRecorder, isAllowedEmail, parseAllowedEmails } from "@hejmly/core/server";
import { users } from "@hejmly/core/server/schema";
import { googleProvisioningSource, withTestAuth } from "@hejmly/core/server/test";
import { parseUserId, type UserId } from "@hejmly/core/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as v from "valibot";
import { createTodoService } from "../server/index.ts";
import { registerTodoTools } from "./index.ts";

const TEST_EMAIL = "basile@example.com";

const seedUser = async (auth: Auth): Promise<UserId> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name: "Basile", email: TEST_EMAIL },
    googleProvisioningSource,
  );
  return parseUserId(user.id);
};

const connect = async (db: Db, actor: UserId): Promise<Client> => {
  const server = new McpServer({ name: "Hejmly-test", version: "1.0.0" });
  registerTodoTools(server, {
    service: createTodoService(db, {
      isMember: (email) => isAllowedEmail(parseAllowedEmails(TEST_EMAIL), email),
    }),
    actor,
    audit: createAuditRecorder(db),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

const withClient = async (fn: (client: Client, actor: UserId, db: Db) => Promise<void>) => {
  await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db }) => {
    const actor = await seedUser(auth);
    await fn(await connect(db, actor), actor, db);
  });
};

const auditActions = (db: Db): string[] =>
  db.$client
    .query("SELECT action FROM audit_log ORDER BY created_at")
    .all()
    .flatMap((row) =>
      typeof row === "object" && row !== null && "action" in row ? [row.action] : [],
    )
    .filter((action): action is string => typeof action === "string");

const auditMetadata = (db: Db, action: string): unknown => {
  const row = db.$client
    .query("SELECT metadata_json FROM audit_log WHERE action = ? ORDER BY created_at DESC")
    .get(action);
  const parsed = v.parse(v.object({ metadata_json: v.string() }), row);
  const metadata: unknown = JSON.parse(parsed.metadata_json);
  return metadata;
};

const ProjectContent = v.object({ project: v.object({ id: v.string() }) });
const TaskContent = v.object({ task: v.object({ id: v.string() }) });

const call = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args });

const addProject = async (client: Client, name: string): Promise<string> => {
  const r = await call(client, "todo__add_project", { name });
  expect(r.isError).toBeFalsy();
  return v.parse(ProjectContent, r.structuredContent).project.id;
};

const addTask = async (client: Client, projectId: string, title: string): Promise<string> => {
  const r = await call(client, "todo__add_task", { projectId, title });
  expect(r.isError).toBeFalsy();
  return v.parse(TaskContent, r.structuredContent).task.id;
};

const textOf = (result: unknown): string => {
  const parsed = v.safeParse(
    v.object({ content: v.array(v.object({ type: v.literal("text"), text: v.string() })) }),
    result,
  );
  return parsed.success ? parsed.output.content.map((c) => c.text).join("\n") : "";
};

describe("todo MCP tools", () => {
  test("over-long ids are refused before the handler runs, so nothing is audited", async () => {
    await withClient(async (client, _actor, db) => {
      const long = "x".repeat(65);
      for (const [name, args] of [
        ["todo__complete_task", { taskId: long }],
        ["todo__list_tasks", { projectId: long }],
        ["todo__add_task", { projectId: long, title: "Dig" }],
      ] as const) {
        const result = await call(client, name, args);
        expect(result.isError).toBe(true);
      }
      expect(auditActions(db)).toEqual([]);
    });
  });

  test("lists the registered tools", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "todo__add_project",
        "todo__add_task",
        "todo__complete_task",
        "todo__list_members",
        "todo__list_projects",
        "todo__list_tasks",
        "todo__remove_project",
        "todo__remove_task",
        "todo__reopen_task",
        "todo__update_project",
        "todo__update_task",
      ]);
      for (const t of tools) expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    });
  });

  test("add_project then list_projects returns it with counts, attributed to the actor", async () => {
    await withClient(async (client, actor) => {
      const added = await call(client, "todo__add_project", {
        name: "Garden",
        description: "Spring beds",
      });
      expect(added.structuredContent).toMatchObject({
        project: {
          name: "Garden",
          description: "Spring beds",
          createdBy: { kind: "user", id: actor },
          taskCounts: { open: 0, done: 0 },
        },
      });

      const listed = await call(client, "todo__list_projects", {});
      expect(listed.structuredContent).toMatchObject({
        projects: [{ name: "Garden", taskCounts: { open: 0, done: 0 } }],
      });
      expect(textOf(listed)).toContain("Garden");
    });
  });

  test("list_projects on an empty store says so", async () => {
    await withClient(async (client) => {
      const listed = await call(client, "todo__list_projects", {});
      expect(listed.structuredContent).toEqual({ projects: [] });
      expect(textOf(listed)).toBe("There are no projects yet.");
    });
  });

  test("tasks flow: add, complete, filter, reopen", async () => {
    await withClient(async (client, actor) => {
      const projectId = await addProject(client, "Garden");
      const dig = await addTask(client, projectId, "Dig");
      await addTask(client, projectId, "Sow");

      const done = await call(client, "todo__complete_task", { taskId: dig });
      expect(done.structuredContent).toMatchObject({
        task: { id: dig, status: { kind: "done", doneBy: actor } },
      });

      const onlyDone = await call(client, "todo__list_tasks", { projectId, status: "done" });
      expect(onlyDone.structuredContent).toMatchObject({
        project: { id: projectId, taskCounts: { open: 1, done: 1 } },
        tasks: [{ title: "Dig" }],
      });

      const onlyOpen = await call(client, "todo__list_tasks", { projectId, status: "open" });
      expect(onlyOpen.structuredContent).toMatchObject({ tasks: [{ title: "Sow" }] });

      const all = await call(client, "todo__list_tasks", { projectId });
      expect(textOf(all)).toContain("Dig");
      expect(textOf(all)).toContain("Sow");

      const reopened = await call(client, "todo__reopen_task", { taskId: dig });
      expect(reopened.structuredContent).toMatchObject({ task: { status: { kind: "open" } } });
    });
  });

  test("completing an already-done task is a tool error", async () => {
    await withClient(async (client) => {
      const projectId = await addProject(client, "Garden");
      const dig = await addTask(client, projectId, "Dig");
      await call(client, "todo__complete_task", { taskId: dig });
      const again = await call(client, "todo__complete_task", { taskId: dig });
      expect(again.isError).toBe(true);
      expect(textOf(again)).toBe("Task is already done.");
      expect(again.structuredContent).toEqual({
        error: { kind: "already_in_state", state: "done" },
      });
    });
  });

  test("unknown ids are tool errors, not crashes", async () => {
    await withClient(async (client) => {
      const missingProject = await call(client, "todo__add_task", {
        projectId: "nope",
        title: "Dig",
      });
      expect(missingProject.isError).toBe(true);
      expect(textOf(missingProject)).toBe('No project found with id "nope".');

      const missingTask = await call(client, "todo__remove_task", { taskId: "nope" });
      expect(missingTask.isError).toBe(true);
      expect(textOf(missingTask)).toBe('No task found with id "nope".');
      expect(missingTask.structuredContent).toEqual({
        error: { kind: "task_not_found", id: "nope" },
      });
    });
  });

  test("update_project and update_task change content; an empty update is rejected", async () => {
    await withClient(async (client) => {
      const projectId = await addProject(client, "Garden");
      const dig = await addTask(client, projectId, "Dig");

      const renamed = await call(client, "todo__update_project", {
        projectId,
        name: "Yard",
        description: null,
      });
      expect(renamed.structuredContent).toMatchObject({
        project: { name: "Yard", description: null },
      });

      const edited = await call(client, "todo__update_task", {
        taskId: dig,
        title: "Dig beds",
        notes: "Deep",
      });
      expect(edited.structuredContent).toMatchObject({
        task: { title: "Dig beds", notes: "Deep" },
      });

      const empty = await call(client, "todo__update_task", { taskId: dig });
      expect(empty.isError).toBe(true);
    });
  });

  test("whitespace-only description and notes become null, like over HTTP", async () => {
    await withClient(async (client) => {
      const project = await call(client, "todo__add_project", { name: "Garden", description: " " });
      expect(project.structuredContent).toMatchObject({ project: { description: null } });
      const projectId = v.parse(ProjectContent, project.structuredContent).project.id;
      const task = await call(client, "todo__add_task", { projectId, title: "Dig", notes: "  " });
      expect(task.structuredContent).toMatchObject({ task: { notes: null } });
      const taskId = v.parse(TaskContent, task.structuredContent).task.id;
      const edited = await call(client, "todo__update_task", { taskId, notes: "   " });
      expect(edited.structuredContent).toMatchObject({ task: { notes: null } });
    });
  });

  test("remove_project deletes its tasks and every call is audited", async () => {
    await withClient(async (client, _actor, db) => {
      const projectId = await addProject(client, "Garden");
      const dig = await addTask(client, projectId, "Dig");

      const removed = await call(client, "todo__remove_project", { projectId });
      expect(removed.structuredContent).toEqual({ id: projectId });

      const orphan = await call(client, "todo__complete_task", { taskId: dig });
      expect(orphan.isError).toBe(true);

      expect(auditActions(db)).toEqual([
        "todo__add_project",
        "todo__add_task",
        "todo__remove_project",
        "todo__complete_task",
      ]);
      expect(auditMetadata(db, "todo__complete_task")).toEqual({
        taskId: dig,
        error: "task_not_found",
      });
    });
  });

  test("list_members names who can be assigned", async () => {
    await withClient(async (client, actor, db) => {
      const now = new Date();
      await db.insert(users).values({
        id: "u_eve",
        name: "Eve",
        email: "eve@example.com",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      });
      const r = await call(client, "todo__list_members", {});
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toEqual({
        members: [{ id: actor, name: "Basile", initial: "B" }],
      });
      expect(textOf(r)).toContain(`Basile (id: ${actor})`);
      expect(auditActions(db)).toEqual(["todo__list_members"]);
    });
  });

  test("add_task takes a due date and an assignee; update_task moves and clears them", async () => {
    await withClient(async (client, actor) => {
      const projectId = await addProject(client, "Garden");
      const added = await call(client, "todo__add_task", {
        projectId,
        title: "Dig",
        dueOn: "2026-10-31",
        assigneeId: actor,
      });
      expect(added.isError).toBeFalsy();
      expect(added.structuredContent).toMatchObject({
        task: { dueOn: "2026-10-31", assignee: { id: actor, name: "Basile" } },
      });
      expect(textOf(added)).toContain("due 2026-10-31, assigned to Basile");
      const taskId = v.parse(TaskContent, added.structuredContent).task.id;

      const moved = await call(client, "todo__update_task", { taskId, dueOn: "2026-11-02" });
      expect(moved.structuredContent).toMatchObject({
        task: { dueOn: "2026-11-02", assignee: { id: actor } },
      });

      const cleared = await call(client, "todo__update_task", {
        taskId,
        dueOn: null,
        assigneeId: null,
      });
      expect(cleared.structuredContent).toMatchObject({ task: { dueOn: null, assignee: null } });
    });
  });

  test("an impossible due date is refused before the handler runs", async () => {
    await withClient(async (client, _actor, db) => {
      const projectId = await addProject(client, "Garden");
      const r = await call(client, "todo__add_task", {
        projectId,
        title: "Dig",
        dueOn: "2026-02-30",
      });
      expect(r.isError).toBe(true);
      expect(auditActions(db)).toEqual(["todo__add_project"]);
    });
  });

  test("assigning someone outside the household is a structured, audited error", async () => {
    await withClient(async (client, _actor, db) => {
      const projectId = await addProject(client, "Garden");
      const r = await call(client, "todo__add_task", {
        projectId,
        title: "Dig",
        assigneeId: "u_nobody",
      });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toEqual({ error: { kind: "member_not_found", id: "u_nobody" } });
      expect(textOf(r)).toContain("todo__list_members");
      expect(auditMetadata(db, "todo__add_task")).toEqual({
        projectId,
        error: "member_not_found",
      });
    });
  });
});
