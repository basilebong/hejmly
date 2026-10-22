import type { SessionVariables } from "@hejmly/core/server";
import { parseUserId } from "@hejmly/core/shared";
import { Hono } from "hono";
import * as v from "valibot";
import {
  CreateProjectInputSchema,
  CreateTaskInputSchema,
  type ProjectId,
  ProjectIdSchema,
  type TaskId,
  TaskIdSchema,
  type TodoError,
  ToggleTaskInputSchema,
  todoErrorStatus,
  UpdateProjectInputSchema,
  UpdateTaskInputSchema,
} from "../shared/index.ts";
import type { TodoService } from "./service.ts";

export type TodoDeps = { service: TodoService };

const handleError = (e: TodoError) => ({ status: todoErrorStatus(e), body: e }) as const;

type ParsedBody<T> = { ok: true; value: T } | { ok: false };

const parseBody = async <S extends v.GenericSchema>(
  req: Request,
  schema: S,
): Promise<ParsedBody<v.InferOutput<S>>> => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false };
  }
  const parsed = v.safeParse(schema, raw);
  if (!parsed.success) return { ok: false };
  return { ok: true, value: parsed.output };
};

const tryParseProjectId = (raw: string | undefined): ProjectId | null => {
  const parsed = v.safeParse(ProjectIdSchema, raw);
  return parsed.success ? parsed.output : null;
};

const tryParseTaskId = (raw: string | undefined): TaskId | null => {
  const parsed = v.safeParse(TaskIdSchema, raw);
  return parsed.success ? parsed.output : null;
};

const invalidInput = (message = "Invalid input") =>
  ({ kind: "invalid_input" as const, message }) as const;

export const createTodoRoutes = (deps: TodoDeps) =>
  new Hono<{ Variables: SessionVariables }>()
    .get("/members", async (c) => c.json({ members: await deps.service.listMembers() }))
    .get("/projects", async (c) => {
      const projects = await deps.service.listProjects();
      return c.json({ projects });
    })
    .post("/projects", async (c) => {
      const parsed = await parseBody(c.req.raw, CreateProjectInputSchema);
      if (!parsed.ok) return c.json(invalidInput(), 400);
      const result = await deps.service.createProject(parsed.value, parseUserId(c.get("user").id));
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ project: result.value }, 201);
    })
    .get("/projects/:id", async (c) => {
      const id = tryParseProjectId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid project id"), 400);
      const result = await deps.service.getProject(id);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json(result.value);
    })
    .patch("/projects/:id", async (c) => {
      const id = tryParseProjectId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid project id"), 400);
      const parsed = await parseBody(c.req.raw, UpdateProjectInputSchema);
      if (!parsed.ok) return c.json(invalidInput(), 400);
      const result = await deps.service.updateProject(id, parsed.value);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ project: result.value });
    })
    .delete("/projects/:id", async (c) => {
      const id = tryParseProjectId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid project id"), 400);
      const result = await deps.service.removeProject(id);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ id: result.value.id });
    })
    .post("/projects/:id/tasks", async (c) => {
      const projectId = tryParseProjectId(c.req.param("id"));
      if (projectId === null) return c.json(invalidInput("Invalid project id"), 400);
      const parsed = await parseBody(c.req.raw, CreateTaskInputSchema);
      if (!parsed.ok) return c.json(invalidInput(), 400);
      const result = await deps.service.createTask(
        projectId,
        parsed.value,
        parseUserId(c.get("user").id),
      );
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ task: result.value }, 201);
    })
    .patch("/tasks/:id", async (c) => {
      const id = tryParseTaskId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid task id"), 400);
      const parsed = await parseBody(c.req.raw, ToggleTaskInputSchema);
      if (!parsed.ok) return c.json(invalidInput(), 400);
      const result = parsed.value.done
        ? await deps.service.completeTask(id, parseUserId(c.get("user").id))
        : await deps.service.reopenTask(id);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ task: result.value });
    })
    .patch("/tasks/:id/content", async (c) => {
      const id = tryParseTaskId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid task id"), 400);
      const parsed = await parseBody(c.req.raw, UpdateTaskInputSchema);
      if (!parsed.ok) return c.json(invalidInput(), 400);
      const result = await deps.service.updateTask(id, parsed.value);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ task: result.value });
    })
    .delete("/tasks/:id", async (c) => {
      const id = tryParseTaskId(c.req.param("id"));
      if (id === null) return c.json(invalidInput("Invalid task id"), 400);
      const result = await deps.service.removeTask(id);
      if (result.kind === "err") {
        const e = handleError(result.error);
        return c.json(e.body, e.status);
      }
      return c.json({ id: result.value.id });
    });

export type TodoRoutes = ReturnType<typeof createTodoRoutes>;
