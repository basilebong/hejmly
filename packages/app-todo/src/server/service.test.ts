import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@hejmly/core/server";
import { users } from "@hejmly/core/server/schema";
import { withTestAuth } from "@hejmly/core/server/test";
import { parseUserId } from "@hejmly/core/shared";
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
