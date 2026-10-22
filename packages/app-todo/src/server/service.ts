import type { Db } from "@hejmly/core/server";
import {
  alias,
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lte,
  sql,
} from "@hejmly/core/server/drizzle";
import { users } from "@hejmly/core/server/schema";
import { err, isErr, ok, type Result, type UserId } from "@hejmly/core/shared";
import { monotonicFactory } from "ulid";
import {
  blankToNull,
  type CreateProjectInput,
  type CreateTaskInput,
  type DueDate,
  isTaskPatch,
  type Project,
  type ProjectId,
  type ProjectWithTasks,
  parseProjectId,
  parseTaskId,
  TASK_PATCH_EMPTY,
  type Task,
  type TaskId,
  type TodoError,
  type TodoMember,
  transition,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from "../shared/index.ts";
import { type TaskInsert, todoDueReminders, todoProjects, todoTasks } from "./schema.ts";
import { type AuthorRow, rowToProject, rowToTask, serializeStatus, toMember } from "./serialize.ts";

export type TodoService = {
  listMembers(): Promise<TodoMember[]>;
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
  listDueByAssignee(today: DueDate): Promise<DueForAssignee[]>;
  claimDueReminder(userId: UserId, day: DueDate): Promise<Result<{ claimed: boolean }, TodoError>>;
  releaseDueReminder(
    userId: UserId,
    day: DueDate,
  ): Promise<Result<{ released: boolean }, TodoError>>;
};

export type DueForAssignee = { assignee: TodoMember; tasks: Task[] };

export type TodoServiceOptions = { isMember: (email: string | null) => boolean };

const authorColumns = { id: users.id, name: users.name, email: users.email } as const;

const assignees = alias(users, "assignee");
const assigneeColumns = {
  id: assignees.id,
  name: assignees.name,
  email: assignees.email,
} as const;
const taskColumns = { task: todoTasks, author: authorColumns, assignee: assigneeColumns } as const;

const projectColumns = {
  project: todoProjects,
  author: authorColumns,
  total: sql`count(${todoTasks.id})`.mapWith(Number),
  done: sql`count(${todoTasks.completedAt})`.mapWith(Number),
} as const;

type TaskWithPeople = {
  task: typeof todoTasks.$inferSelect;
  author: AuthorRow;
  assignee: AuthorRow;
};

export const createTodoService = (db: Db, { isMember }: TodoServiceOptions): TodoService => {
  const nextId = monotonicFactory();

  const selectTasks = () =>
    db
      .select(taskColumns)
      .from(todoTasks)
      .leftJoin(users, eq(users.id, todoTasks.addedByUserId))
      .leftJoin(assignees, eq(assignees.id, todoTasks.assigneeUserId));

  const toTask = (r: TaskWithPeople): Task => rowToTask(r.task, r.author, r.assignee);

  const assigneeProblem = (
    id: UserId | null | undefined,
    found: readonly { email: string | null }[],
  ): TodoError | null => {
    if (id === null || id === undefined) return null;
    const row = found[0];
    return row !== undefined && isMember(row.email) ? null : { kind: "member_not_found", id };
  };

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

  const fetchTask = async (id: TaskId): Promise<TaskWithPeople | null> => {
    const rows = await selectTasks().where(eq(todoTasks.id, id)).limit(1);
    return rows[0] ?? null;
  };

  const fetchAuthor = async (userId: UserId): Promise<AuthorRow> => {
    const rows = await db.select(authorColumns).from(users).where(eq(users.id, userId)).limit(1);
    return rows[0] ?? null;
  };

  return {
    async listMembers() {
      const rows = await db.select(authorColumns).from(users);
      return rows
        .filter((r) => isMember(r.email))
        .map(toMember)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

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
      const rows = await selectTasks()
        .where(eq(todoTasks.projectId, id))
        .orderBy(asc(todoTasks.createdAt), asc(todoTasks.id));
      return ok({ project, tasks: rows.map(toTask) });
    },

    async createProject(input, by) {
      const now = new Date();
      const id = parseProjectId(nextId());
      const inserted = await db
        .insert(todoProjects)
        .values({
          id,
          name: input.name,
          description: blankToNull(input.description ?? null),
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
      if (input.description !== undefined) patch.description = blankToNull(input.description);
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
      const now = new Date();
      const id = parseTaskId(nextId());
      const problem = db.transaction(
        (tx): TodoError | null => {
          const project = tx
            .select({ id: todoProjects.id })
            .from(todoProjects)
            .where(eq(todoProjects.id, projectId))
            .limit(1)
            .all();
          if (project[0] === undefined) return { kind: "project_not_found", id: projectId };
          const assigneeId = input.assigneeId;
          const assignee =
            assigneeId === undefined
              ? []
              : tx.select(authorColumns).from(users).where(eq(users.id, assigneeId)).limit(1).all();
          const assigneeError = assigneeProblem(assigneeId, assignee);
          if (assigneeError !== null) return assigneeError;
          tx.insert(todoTasks)
            .values({
              id,
              projectId,
              title: input.title,
              notes: blankToNull(input.notes ?? null),
              statusJson: serializeStatus({ kind: "open" }),
              dueOn: input.dueOn ?? null,
              assigneeUserId: assigneeId ?? null,
              addedByUserId: by,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
            })
            .run();
          return null;
        },
        { behavior: "immediate" },
      );
      if (problem !== null) return err(problem);
      const created = await fetchTask(id);
      if (created === null) return err({ kind: "task_not_found", id });
      return ok(toTask(created));
    },

    async updateTask(id, input) {
      if (!isTaskPatch(input)) return err({ kind: "invalid_input", message: TASK_PATCH_EMPTY });
      const patch: Partial<Pick<TaskInsert, "title" | "notes" | "dueOn" | "assigneeUserId">> & {
        updatedAt: Date;
      } = { updatedAt: new Date() };
      if (input.title !== undefined) patch.title = input.title;
      if (input.notes !== undefined) patch.notes = blankToNull(input.notes);
      if (input.dueOn !== undefined) patch.dueOn = input.dueOn;
      if (input.assigneeId !== undefined) patch.assigneeUserId = input.assigneeId;
      const problem = db.transaction(
        (tx): TodoError | null => {
          const task = tx
            .select({ id: todoTasks.id })
            .from(todoTasks)
            .where(eq(todoTasks.id, id))
            .limit(1)
            .all();
          if (task[0] === undefined) return { kind: "task_not_found", id };
          const assigneeId = input.assigneeId;
          const assignee =
            assigneeId === undefined || assigneeId === null
              ? []
              : tx.select(authorColumns).from(users).where(eq(users.id, assigneeId)).limit(1).all();
          const assigneeError = assigneeProblem(assigneeId, assignee);
          if (assigneeError !== null) return assigneeError;
          tx.update(todoTasks).set(patch).where(eq(todoTasks.id, id)).run();
          return null;
        },
        { behavior: "immediate" },
      );
      if (problem !== null) return err(problem);
      const updated = await fetchTask(id);
      if (updated === null) return err({ kind: "task_not_found", id });
      return ok(toTask(updated));
    },

    async completeTask(id, by) {
      const existing = await fetchTask(id);
      if (existing === null) return err({ kind: "task_not_found", id });
      const current = toTask(existing);
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
      return ok(rowToTask(row, existing.author, existing.assignee));
    },

    async reopenTask(id) {
      const existing = await fetchTask(id);
      if (existing === null) return err({ kind: "task_not_found", id });
      const current = toTask(existing);
      const next = transition(current.status, { kind: "reopen" });
      if (isErr(next)) return err(next.error);
      const updated = await db
        .update(todoTasks)
        .set({ statusJson: serializeStatus(next.value), completedAt: null })
        .where(eq(todoTasks.id, id))
        .returning();
      const row = updated[0];
      if (row === undefined) return err({ kind: "task_not_found", id });
      return ok(rowToTask(row, existing.author, existing.assignee));
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

    async claimDueReminder(userId, day) {
      const claimed = await db
        .insert(todoDueReminders)
        .values({ userId, day, sentAt: new Date() })
        .onConflictDoNothing()
        .returning({ userId: todoDueReminders.userId });
      return ok({ claimed: claimed.length > 0 });
    },

    async releaseDueReminder(userId, day) {
      const released = await db
        .delete(todoDueReminders)
        .where(and(eq(todoDueReminders.userId, userId), eq(todoDueReminders.day, day)))
        .returning({ userId: todoDueReminders.userId });
      return ok({ released: released.length > 0 });
    },

    async listDueByAssignee(today) {
      const rows = await selectTasks()
        .where(
          and(
            isNull(todoTasks.completedAt),
            isNotNull(todoTasks.assigneeUserId),
            isNotNull(todoTasks.dueOn),
            lte(todoTasks.dueOn, today),
          ),
        )
        .orderBy(asc(todoTasks.dueOn), asc(todoTasks.createdAt), asc(todoTasks.id));
      const byAssignee = new Map<UserId, DueForAssignee>();
      for (const row of rows) {
        if (row.assignee === null || !isMember(row.assignee.email)) continue;
        const task = toTask(row);
        if (task.assignee === null) continue;
        const entry = byAssignee.get(task.assignee.id) ?? { assignee: task.assignee, tasks: [] };
        entry.tasks.push(task);
        byAssignee.set(task.assignee.id, entry);
      }
      return [...byAssignee.values()].sort((a, b) =>
        a.assignee.name.localeCompare(b.assignee.name),
      );
    },
  };
};
