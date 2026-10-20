import type { Db } from "@hejmly/core/server";
import { asc, desc, eq, sql } from "@hejmly/core/server/drizzle";
import { users } from "@hejmly/core/server/schema";
import { err, isErr, ok, type Result, type UserId } from "@hejmly/core/shared";
import { monotonicFactory } from "ulid";
import {
  type CreateProjectInput,
  type CreateTaskInput,
  type Project,
  type ProjectId,
  type ProjectWithTasks,
  parseProjectId,
  parseTaskId,
  type Task,
  type TaskId,
  type TodoError,
  transition,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from "../shared/index.ts";
import { todoProjects, todoTasks } from "./schema.ts";
import { type AuthorRow, rowToProject, rowToTask, serializeStatus } from "./serialize.ts";

export type TodoService = {
  listProjects(): Promise<Project[]>;
  getProject(id: ProjectId): Promise<Result<ProjectWithTasks, TodoError>>;
  createProject(input: CreateProjectInput, by: UserId): Promise<Result<Project, TodoError>>;
  updateProject(id: ProjectId, input: UpdateProjectInput): Promise<Result<Project, TodoError>>;
  removeProject(id: ProjectId): Promise<Result<{ id: ProjectId }, TodoError>>;
  createTask(
    projectId: ProjectId,
    input: CreateTaskInput,
    by: UserId,
  ): Promise<Result<Task, TodoError>>;
  updateTask(id: TaskId, input: UpdateTaskInput): Promise<Result<Task, TodoError>>;
  completeTask(id: TaskId, by: UserId): Promise<Result<Task, TodoError>>;
  reopenTask(id: TaskId): Promise<Result<Task, TodoError>>;
  removeTask(id: TaskId): Promise<Result<{ id: TaskId }, TodoError>>;
};

const authorColumns = { id: users.id, name: users.name, email: users.email } as const;

const projectColumns = {
  project: todoProjects,
  author: authorColumns,
  total: sql`count(${todoTasks.id})`.mapWith(Number),
  done: sql`count(${todoTasks.completedAt})`.mapWith(Number),
} as const;

type TaskWithAuthor = { task: typeof todoTasks.$inferSelect; author: AuthorRow };

export const createTodoService = (db: Db): TodoService => {
  const nextId = monotonicFactory();

  const fetchProject = async (id: ProjectId): Promise<Project | null> => {
    const rows = await db
      .select(projectColumns)
      .from(todoProjects)
      .leftJoin(users, eq(users.id, todoProjects.createdByUserId))
      .leftJoin(todoTasks, eq(todoTasks.projectId, todoProjects.id))
      .where(eq(todoProjects.id, id))
      .groupBy(todoProjects.id)
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : rowToProject(row.project, row.author, row);
  };

  const fetchTask = async (id: TaskId): Promise<TaskWithAuthor | null> => {
    const rows = await db
      .select({ task: todoTasks, author: authorColumns })
      .from(todoTasks)
      .leftJoin(users, eq(users.id, todoTasks.addedByUserId))
      .where(eq(todoTasks.id, id))
      .limit(1);
    return rows[0] ?? null;
  };

  const fetchAuthor = async (userId: UserId): Promise<AuthorRow> => {
    const rows = await db.select(authorColumns).from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ?? null;
  };

  return {
    async listProjects() {
      const rows = await db
        .select(projectColumns)
        .from(todoProjects)
        .leftJoin(users, eq(users.id, todoProjects.createdByUserId))
        .leftJoin(todoTasks, eq(todoTasks.projectId, todoProjects.id))
        .groupBy(todoProjects.id)
        .orderBy(desc(todoProjects.createdAt), desc(todoProjects.id));
      return rows.map((r) => rowToProject(r.project, r.author, r));
    },

    async getProject(id) {
      const project = await fetchProject(id);
      if (project === null) return err({ kind: "project_not_found", id });
      const rows = await db
        .select({ task: todoTasks, author: authorColumns })
        .from(todoTasks)
        .leftJoin(users, eq(users.id, todoTasks.addedByUserId))
        .where(eq(todoTasks.projectId, id))
        .orderBy(asc(todoTasks.createdAt), asc(todoTasks.id));
      return ok({ project, tasks: rows.map((r) => rowToTask(r.task, r.author)) });
    },

    async createProject(input, by) {
      const now = new Date();
      const id = parseProjectId(nextId());
      const inserted = await db
        .insert(todoProjects)
        .values({
          id,
          name: input.name,
          description: input.description ?? null,
          createdByUserId: by,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) return err({ kind: "project_not_found", id });
      return ok(rowToProject(row, await fetchAuthor(by), { total: 0, done: 0 }));
    },

    async updateProject(id, input) {
      if (input.name === undefined && input.description === undefined) {
        return err({ kind: "invalid_input", message: "Provide a name or description to update" });
      }
      const patch: { name?: string; description?: string | null; updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined) patch.description = input.description;
      const updated = await db
        .update(todoProjects)
        .set(patch)
        .where(eq(todoProjects.id, id))
        .returning({ id: todoProjects.id });
      if (updated[0] === undefined) return err({ kind: "project_not_found", id });
      const project = await fetchProject(id);
      if (project === null) return err({ kind: "project_not_found", id });
      return ok(project);
    },

    async removeProject(id) {
      const deleted = await db
        .delete(todoProjects)
        .where(eq(todoProjects.id, id))
        .returning({ id: todoProjects.id });
      const row = deleted[0];
      if (row === undefined) return err({ kind: "project_not_found", id });
      return ok({ id: parseProjectId(row.id) });
    },

    async createTask(projectId, input, by) {
      const exists = await db
        .select({ id: todoProjects.id })
        .from(todoProjects)
        .where(eq(todoProjects.id, projectId))
        .limit(1);
      if (exists[0] === undefined) return err({ kind: "project_not_found", id: projectId });
      const now = new Date();
      const id = parseTaskId(nextId());
      const inserted = await db
        .insert(todoTasks)
        .values({
          id,
          projectId,
          title: input.title,
          notes: input.notes ?? null,
          statusJson: serializeStatus({ kind: "open" }),
          addedByUserId: by,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) return err({ kind: "task_not_found", id });
      return ok(rowToTask(row, await fetchAuthor(by)));
    },

    async updateTask(id, input) {
      if (input.title === undefined && input.notes === undefined) {
        return err({ kind: "invalid_input", message: "Provide a title or notes to update" });
      }
      const existing = await fetchTask(id);
      if (existing === null) return err({ kind: "task_not_found", id });
      const patch: { title?: string; notes?: string | null; updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (input.title !== undefined) patch.title = input.title;
      if (input.notes !== undefined) patch.notes = input.notes;
      const updated = await db.update(todoTasks).set(patch).where(eq(todoTasks.id, id)).returning();
      const row = updated[0];
      if (row === undefined) return err({ kind: "task_not_found", id });
      return ok(rowToTask(row, existing.author));
    },

    async completeTask(id, by) {
      const existing = await fetchTask(id);
      if (existing === null) return err({ kind: "task_not_found", id });
      const current = rowToTask(existing.task, existing.author);
      const at = Date.now();
      const next = transition(current.status, { kind: "complete", by, at });
      if (isErr(next)) return err(next.error);
      const updated = await db
        .update(todoTasks)
        .set({ statusJson: serializeStatus(next.value), completedAt: new Date(at) })
        .where(eq(todoTasks.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) return err({ kind: "task_not_found", id });
      return ok(rowToTask(row, existing.author));
    },

    async reopenTask(id) {
      const existing = await fetchTask(id);
      if (existing === null) return err({ kind: "task_not_found", id });
      const current = rowToTask(existing.task, existing.author);
      const next = transition(current.status, { kind: "reopen" });
      if (isErr(next)) return err(next.error);
      const updated = await db
        .update(todoTasks)
        .set({ statusJson: serializeStatus(next.value), completedAt: null })
        .where(eq(todoTasks.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) return err({ kind: "task_not_found", id });
      return ok(rowToTask(row, existing.author));
    },

    async removeTask(id) {
      const deleted = await db
        .delete(todoTasks)
        .where(eq(todoTasks.id, id))
        .returning({ id: todoTasks.id });
      const row = deleted[0];
      if (row === undefined) return err({ kind: "task_not_found", id });
      return ok({ id: parseTaskId(row.id) });
    },
  };
};
