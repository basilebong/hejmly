import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@hejmly/core/server";
import { users } from "@hejmly/core/server/schema";
import { withTestAuth } from "@hejmly/core/server/test";
import { parseUserId } from "@hejmly/core/shared";
import { parseDueDate } from "../shared/index.ts";
import { createTodoService } from "./service.ts";

const ANNA = parseUserId("u_anna");
const BASILE = parseUserId("u_basile");

const seedUsers = async (db: Db): Promise<void> => {
  const now = new Date();
  await db.insert(users).values([
    { id: ANNA, name: "Anna", email: "anna@example.com", createdAt: now, updatedAt: now },
    { id: BASILE, name: "Basile", email: "basile@example.com", createdAt: now, updatedAt: now },
  ]);
};

const withFileDb = async (fn: (db: Db, path: string) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), "hejmly-todo-"));
  const path = join(dir, "app.db");
  try {
    await withTestAuth({ path }, async ({ db }) => {
      await seedUsers(db);
      await fn(db, path);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const deleteAnnaFrom = (path: string): unknown => {
  const other = new Database(path);
  try {
    other.run("DELETE FROM users WHERE id = 'u_anna'");
    return null;
  } catch (error) {
    return error;
  } finally {
    other.close();
  }
};

describe("todo service assignee check", () => {
  test("no other connection can delete the assignee between the check and the insert", async () => {
    await withFileDb(async (db, path) => {
      let concurrentDelete: unknown = "not attempted";
      const service = createTodoService(db, {
        isMember: (email) => {
          if (email === "anna@example.com") concurrentDelete = deleteAnnaFrom(path);
          return true;
        },
      });
      const project = await service.createProject({ name: "Garden" }, BASILE);
      if (project.kind === "err") throw new Error("project not created");
      const created = await service.createTask(
        project.value.id,
        { title: "Dig", assigneeId: ANNA },
        BASILE,
      );
      expect(created).toMatchObject({ kind: "ok", value: { assignee: { id: ANNA } } });
      expect(String(concurrentDelete)).toContain("database is locked");
    });
  });

  test("no other connection can delete the assignee between the check and the update", async () => {
    await withFileDb(async (db, path) => {
      let deleting = false;
      let concurrentDelete: unknown = "not attempted";
      const service = createTodoService(db, {
        isMember: (email) => {
          if (deleting && email === "anna@example.com") concurrentDelete = deleteAnnaFrom(path);
          return true;
        },
      });
      const project = await service.createProject({ name: "Garden" }, BASILE);
      if (project.kind === "err") throw new Error("project not created");
      const task = await service.createTask(project.value.id, { title: "Dig" }, BASILE);
      if (task.kind === "err") throw new Error("task not created");
      deleting = true;
      const updated = await service.updateTask(task.value.id, { assigneeId: ANNA });
      expect(updated).toMatchObject({ kind: "ok", value: { assignee: { id: ANNA } } });
      expect(String(concurrentDelete)).toContain("database is locked");
    });
  });
});

describe("todo service due by assignee", () => {
  test("lists each member's open, assigned tasks that are due or overdue, oldest due first", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seedUsers(db);
      const service = createTodoService(db, { isMember: () => true });
      const project = await service.createProject({ name: "House" }, ANNA);
      if (project.kind === "err") throw new Error("project not created");
      const add = async (title: string, dueOn: string | undefined, assigneeId?: typeof ANNA) => {
        const created = await service.createTask(
          project.value.id,
          {
            title,
            ...(dueOn === undefined ? {} : { dueOn: parseDueDate(dueOn) }),
            ...(assigneeId === undefined ? {} : { assigneeId }),
          },
          ANNA,
        );
        if (created.kind === "err") throw new Error(`task ${title} not created`);
        return created.value;
      };
      await add("Today", "2026-10-22", ANNA);
      await add("Overdue", "2026-10-20", ANNA);
      await add("Tomorrow", "2026-10-23", ANNA);
      await add("No date", undefined, ANNA);
      await add("Unassigned", "2026-10-22");
      await add("Basile's", "2026-10-22", BASILE);
      const done = await add("Done", "2026-10-21", ANNA);
      await service.completeTask(done.id, ANNA);

      const due = await service.listDueByAssignee(parseDueDate("2026-10-22"));
      expect(
        due.map((d) => ({ who: d.assignee.name, tasks: d.tasks.map((t) => t.title) })),
      ).toEqual([
        { who: "Anna", tasks: ["Overdue", "Today"] },
        { who: "Basile", tasks: ["Basile's"] },
      ]);
    });
  });

  test("skips people who are no longer members", async () => {
    await withTestAuth({}, async ({ db }) => {
      await seedUsers(db);
      let annaIsMember = true;
      const service = createTodoService(db, {
        isMember: (email) => email !== "anna@example.com" || annaIsMember,
      });
      const project = await service.createProject({ name: "House" }, ANNA);
      if (project.kind === "err") throw new Error("project not created");
      await service.createTask(
        project.value.id,
        { title: "Today", dueOn: parseDueDate("2026-10-22"), assigneeId: ANNA },
        ANNA,
      );
      annaIsMember = false;
      expect(await service.listDueByAssignee(parseDueDate("2026-10-22"))).toEqual([]);
    });
  });
});
