import { describe, expect, test } from "bun:test";
import { type Auth, createRequireSession, type SessionVariables } from "@hejmly/core/server";
import { googleProvisioningSource, withTestAuth } from "@hejmly/core/server/test";
import { Hono } from "hono";
import * as v from "valibot";
import { createTodoRoutes } from "./routes.ts";
import { createTodoService } from "./service.ts";

const TEST_EMAIL = "basile@example.com";

type TestApp = Hono<{ Variables: SessionVariables }>;

type TodoTestContext = { app: TestApp; cookie: string; userId: string };

const seedSessionCookie = async (
  auth: Auth,
  signSessionCookie: (token: string) => Promise<string>,
): Promise<{ userId: string; cookie: string }> => {
  const ctx = await auth.$context;
  const user = await ctx.internalAdapter.createUser(
    { name: "Basile", email: TEST_EMAIL },
    googleProvisioningSource,
  );
  const session = await ctx.internalAdapter.createSession(user.id);
  const signed = await signSessionCookie(session.token);
  return { userId: user.id, cookie: `Hejmly.session_token=${signed}` };
};

const withTodo = async (fn: (ctx: TodoTestContext) => Promise<void>): Promise<void> => {
  await withTestAuth({ allowedEmails: TEST_EMAIL }, async ({ auth, db, signSessionCookie }) => {
    const { userId, cookie } = await seedSessionCookie(auth, signSessionCookie);
    const app: TestApp = new Hono<{ Variables: SessionVariables }>()
      .use("/api/*", createRequireSession(auth))
      .route("/api/todo", createTodoRoutes({ service: createTodoService(db) }));
    await fn({ app, cookie, userId });
  });
};

const AuthorSchema = v.object({ kind: v.literal("user"), id: v.string(), name: v.string() });

const ProjectSchema = v.object({
  id: v.string(),
  name: v.string(),
  description: v.nullable(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: AuthorSchema,
  taskCounts: v.object({ open: v.number(), done: v.number() }),
});
type ProjectResponse = v.InferOutput<typeof ProjectSchema>;

const TaskSchema = v.object({
  id: v.string(),
  projectId: v.string(),
  title: v.string(),
  notes: v.nullable(v.string()),
  status: v.union([
    v.object({ kind: v.literal("open") }),
    v.object({ kind: v.literal("done"), doneAt: v.number(), doneBy: v.string() }),
  ]),
  createdAt: v.number(),
  updatedAt: v.number(),
  addedBy: AuthorSchema,
});
type TaskResponse = v.InferOutput<typeof TaskSchema>;

const ProjectEnvelope = v.object({ project: ProjectSchema });
const ProjectList = v.object({ projects: v.array(ProjectSchema) });
const ProjectDetail = v.object({ project: ProjectSchema, tasks: v.array(TaskSchema) });
const TaskEnvelope = v.object({ task: TaskSchema });
const IdEnvelope = v.object({ id: v.string() });
const ErrorBody = v.object({
  kind: v.string(),
  id: v.optional(v.string()),
  state: v.optional(v.string()),
  message: v.optional(v.string()),
});

const read = async <S extends v.GenericSchema>(
  res: Response,
  schema: S,
): Promise<v.InferOutput<S>> => v.parse(schema, await res.json());

const send = (
  app: TestApp,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> => {
  const init: RequestInit = { method, headers: { cookie, "content-type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return Promise.resolve(app.request(path, init));
};

const createProject = async (
  app: TestApp,
  cookie: string,
  body: { name: string; description?: string },
): Promise<ProjectResponse> => {
  const res = await send(app, cookie, "POST", "/api/todo/projects", body);
  expect(res.status).toBe(201);
  return (await read(res, ProjectEnvelope)).project;
};

const createTask = async (
  app: TestApp,
  cookie: string,
  projectId: string,
  body: { title: string; notes?: string },
): Promise<TaskResponse> => {
  const res = await send(app, cookie, "POST", `/api/todo/projects/${projectId}/tasks`, body);
  expect(res.status).toBe(201);
  return (await read(res, TaskEnvelope)).task;
};

describe("todo routes", () => {
  test("every route is 401 without a session", async () => {
    await withTodo(async ({ app }) => {
      const probes: [string, string, unknown?][] = [
        ["GET", "/api/todo/projects"],
        ["POST", "/api/todo/projects", { name: "Garden" }],
        ["GET", "/api/todo/projects/p1"],
        ["PATCH", "/api/todo/projects/p1", { name: "Yard" }],
        ["DELETE", "/api/todo/projects/p1"],
        ["POST", "/api/todo/projects/p1/tasks", { title: "Dig" }],
        ["PATCH", "/api/todo/tasks/t1", { done: true }],
        ["PATCH", "/api/todo/tasks/t1/content", { title: "Dig" }],
        ["DELETE", "/api/todo/tasks/t1"],
      ];
      for (const [method, path, body] of probes) {
        const res = await send(app, "", method, path, body);
        expect({ method, path, status: res.status }).toEqual({ method, path, status: 401 });
      }
    });
  });

  describe("projects", () => {
    test("create returns the project attributed to the user with zero counts", async () => {
      await withTodo(async ({ app, cookie, userId }) => {
        const project = await createProject(app, cookie, {
          name: "  Garden ",
          description: "Spring beds",
        });
        expect(project).toMatchObject({
          name: "Garden",
          description: "Spring beds",
          createdBy: { kind: "user", id: userId, name: "Basile" },
          taskCounts: { open: 0, done: 0 },
        });
      });
    });

    test("create rejects a blank name", async () => {
      await withTodo(async ({ app, cookie }) => {
        const res = await send(app, cookie, "POST", "/api/todo/projects", { name: "  " });
        expect(res.status).toBe(400);
        expect((await read(res, ErrorBody)).kind).toBe("invalid_input");
      });
    });

    test("create rejects a malformed JSON body", async () => {
      await withTodo(async ({ app, cookie }) => {
        const res = await app.request("/api/todo/projects", {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: "{not json",
        });
        expect(res.status).toBe(400);
      });
    });

    test("list is newest first and carries open/done counts", async () => {
      await withTodo(async ({ app, cookie }) => {
        const garden = await createProject(app, cookie, { name: "Garden" });
        await createProject(app, cookie, { name: "Taxes" });
        const a = await createTask(app, cookie, garden.id, { title: "Dig" });
        await createTask(app, cookie, garden.id, { title: "Sow" });
        await createTask(app, cookie, garden.id, { title: "Water" });
        await send(app, cookie, "PATCH", `/api/todo/tasks/${a.id}`, { done: true });

        const res = await send(app, cookie, "GET", "/api/todo/projects");
        expect(res.status).toBe(200);
        const { projects } = await read(res, ProjectList);
        expect(projects.map((p) => [p.name, p.taskCounts])).toEqual([
          ["Taxes", { open: 0, done: 0 }],
          ["Garden", { open: 2, done: 1 }],
        ]);
      });
    });

    test("get returns the project with its tasks oldest first", async () => {
      await withTodo(async ({ app, cookie }) => {
        const garden = await createProject(app, cookie, { name: "Garden" });
        const other = await createProject(app, cookie, { name: "Other" });
        await createTask(app, cookie, garden.id, { title: "Dig" });
        await createTask(app, cookie, garden.id, { title: "Sow", notes: "Tomatoes" });
        await createTask(app, cookie, other.id, { title: "Elsewhere" });

        const res = await send(app, cookie, "GET", `/api/todo/projects/${garden.id}`);
        expect(res.status).toBe(200);
        const detail = await read(res, ProjectDetail);
        expect(detail.project.taskCounts).toEqual({ open: 2, done: 0 });
        expect(detail.tasks.map((t) => [t.title, t.notes])).toEqual([
          ["Dig", null],
          ["Sow", "Tomatoes"],
        ]);
      });
    });

    test("get of an unknown project is 404", async () => {
      await withTodo(async ({ app, cookie }) => {
        const res = await send(app, cookie, "GET", "/api/todo/projects/nope");
        expect(res.status).toBe(404);
        expect(await read(res, ErrorBody)).toEqual({ kind: "project_not_found", id: "nope" });
      });
    });

    test("update changes only the provided fields and can clear the description", async () => {
      await withTodo(async ({ app, cookie }) => {
        const p = await createProject(app, cookie, { name: "Garden", description: "Beds" });
        await createTask(app, cookie, p.id, { title: "Dig" });
        const renamed = await send(app, cookie, "PATCH", `/api/todo/projects/${p.id}`, {
          name: "Yard",
        });
        expect(renamed.status).toBe(200);
        expect((await read(renamed, ProjectEnvelope)).project).toMatchObject({
          name: "Yard",
          description: "Beds",
          taskCounts: { open: 1, done: 0 },
        });

        const cleared = await send(app, cookie, "PATCH", `/api/todo/projects/${p.id}`, {
          description: null,
        });
        expect((await read(cleared, ProjectEnvelope)).project).toMatchObject({
          name: "Yard",
          description: null,
        });
      });
    });

    test("update with an empty patch is 400 and of an unknown project is 404", async () => {
      await withTodo(async ({ app, cookie }) => {
        const p = await createProject(app, cookie, { name: "Garden" });
        const empty = await send(app, cookie, "PATCH", `/api/todo/projects/${p.id}`, {});
        expect(empty.status).toBe(400);
        const missing = await send(app, cookie, "PATCH", "/api/todo/projects/nope", { name: "X" });
        expect(missing.status).toBe(404);
      });
    });

    test("delete removes the project and cascades to its tasks", async () => {
      await withTodo(async ({ app, cookie }) => {
        const p = await createProject(app, cookie, { name: "Garden" });
        const t = await createTask(app, cookie, p.id, { title: "Dig" });

        const res = await send(app, cookie, "DELETE", `/api/todo/projects/${p.id}`);
        expect(res.status).toBe(200);
        expect(await read(res, IdEnvelope)).toEqual({ id: p.id });

        const gone = await send(app, cookie, "GET", `/api/todo/projects/${p.id}`);
        expect(gone.status).toBe(404);
        const orphan = await send(app, cookie, "PATCH", `/api/todo/tasks/${t.id}`, { done: true });
        expect(orphan.status).toBe(404);
        expect(await read(orphan, ErrorBody)).toEqual({ kind: "task_not_found", id: t.id });

        const again = await send(app, cookie, "DELETE", `/api/todo/projects/${p.id}`);
        expect(again.status).toBe(404);
      });
    });
  });

  describe("tasks", () => {
    test("create adds an open task attributed to the user", async () => {
      await withTodo(async ({ app, cookie, userId }) => {
        const p = await createProject(app, cookie, { name: "Garden" });
        const task = await createTask(app, cookie, p.id, { title: " Dig ", notes: " Deep " });
        expect(task).toMatchObject({
          projectId: p.id,
          title: "Dig",
          notes: "Deep",
          status: { kind: "open" },
          addedBy: { kind: "user", id: userId },
        });
      });
    });

    test("create in an unknown project is 404 and a blank title is 400", async () => {
      await withTodo(async ({ app, cookie }) => {
        const missing = await send(app, cookie, "POST", "/api/todo/projects/nope/tasks", {
          title: "Dig",
        });
        expect(missing.status).toBe(404);
        expect((await read(missing, ErrorBody)).kind).toBe("project_not_found");

        const p = await createProject(app, cookie, { name: "Garden" });
        const blank = await send(app, cookie, "POST", `/api/todo/projects/${p.id}/tasks`, {
          title: "",
        });
        expect(blank.status).toBe(400);
      });
    });

    test("toggle done records who and when, then reopen clears it", async () => {
      await withTodo(async ({ app, cookie, userId }) => {
        const p = await createProject(app, cookie, { name: "Garden" });
        const t = await createTask(app, cookie, p.id, { title: "Dig" });

        const done = await send(app, cookie, "PATCH", `/api/todo/tasks/${t.id}`, { done: true });
        expect(done.status).toBe(200);
        const doneTask = (await read(done, TaskEnvelope)).task;
        expect(doneTask.status).toMatchObject({ kind: "done", doneBy: userId });

        const open = await send(app, cookie, "PATCH", `/api/todo/tasks/${t.id}`, { done: false });
        expect((await read(open, TaskEnvelope)).task.status).toEqual({ kind: "open" });
      });
    });

    test("completing a done task is 409 and a bad body is 400", async () => {
      await withTodo(async ({ app, cookie }) => {
        const p = await createProject(app, cookie, { name: "Garden" });
        const t = await createTask(app, cookie, p.id, { title: "Dig" });
        await send(app, cookie, "PATCH", `/api/todo/tasks/${t.id}`, { done: true });

        const twice = await send(app, cookie, "PATCH", `/api/todo/tasks/${t.id}`, { done: true });
        expect(twice.status).toBe(409);
        expect(await read(twice, ErrorBody)).toEqual({ kind: "already_in_state", state: "done" });

        const bad = await send(app, cookie, "PATCH", `/api/todo/tasks/${t.id}`, { done: "yes" });
        expect(bad.status).toBe(400);
      });
    });

    test("update content changes title and clears notes", async () => {
      await withTodo(async ({ app, cookie }) => {
        const p = await createProject(app, cookie, { name: "Garden" });
        const t = await createTask(app, cookie, p.id, { title: "Dig", notes: "Deep" });
        const res = await send(app, cookie, "PATCH", `/api/todo/tasks/${t.id}/content`, {
          title: "Dig beds",
          notes: null,
        });
        expect(res.status).toBe(200);
        expect((await read(res, TaskEnvelope)).task).toMatchObject({
          title: "Dig beds",
          notes: null,
          status: { kind: "open" },
        });
      });
    });

    test("update content with an empty patch is 400 and of an unknown task is 404", async () => {
      await withTodo(async ({ app, cookie }) => {
        const p = await createProject(app, cookie, { name: "Garden" });
        const t = await createTask(app, cookie, p.id, { title: "Dig" });
        const empty = await send(app, cookie, "PATCH", `/api/todo/tasks/${t.id}/content`, {});
        expect(empty.status).toBe(400);
        const missing = await send(app, cookie, "PATCH", "/api/todo/tasks/nope/content", {
          title: "X",
        });
        expect(missing.status).toBe(404);
      });
    });

    test("delete removes the task and updates the project counts", async () => {
      await withTodo(async ({ app, cookie }) => {
        const p = await createProject(app, cookie, { name: "Garden" });
        const t = await createTask(app, cookie, p.id, { title: "Dig" });
        await createTask(app, cookie, p.id, { title: "Sow" });

        const res = await send(app, cookie, "DELETE", `/api/todo/tasks/${t.id}`);
        expect(res.status).toBe(200);
        expect(await read(res, IdEnvelope)).toEqual({ id: t.id });

        const detail = await read(
          await send(app, cookie, "GET", `/api/todo/projects/${p.id}`),
          ProjectDetail,
        );
        expect(detail.project.taskCounts).toEqual({ open: 1, done: 0 });
        expect(detail.tasks.map((x) => x.title)).toEqual(["Sow"]);

        const again = await send(app, cookie, "DELETE", `/api/todo/tasks/${t.id}`);
        expect(again.status).toBe(404);
      });
    });
  });
});
