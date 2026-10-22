import {
  type CreateProjectInput,
  type CreateTaskInput,
  DueDateSchema,
  type Project,
  type ProjectId,
  ProjectIdSchema,
  type ProjectWithTasks,
  type Task,
  type TaskId,
  TaskIdSchema,
  type TodoMember,
  type UpdateProjectInput,
  type UpdateTaskInput,
} from "@hejmly/app-todo/shared";
import { UserIdSchema } from "@hejmly/core/shared";
import * as v from "valibot";

const AuthorSchema = v.union([
  v.object({ kind: v.literal("user"), id: UserIdSchema, name: v.string(), initial: v.string() }),
  v.object({ kind: v.literal("unknown"), name: v.string(), initial: v.string() }),
]);

const MemberSchema = v.object({ id: UserIdSchema, name: v.string(), initial: v.string() });

const ProjectSchema = v.object({
  id: ProjectIdSchema,
  name: v.string(),
  description: v.nullable(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  createdBy: AuthorSchema,
  taskCounts: v.object({ open: v.number(), done: v.number() }),
});

const TaskSchema = v.object({
  id: TaskIdSchema,
  projectId: ProjectIdSchema,
  title: v.string(),
  notes: v.nullable(v.string()),
  status: v.union([
    v.object({ kind: v.literal("open") }),
    v.object({ kind: v.literal("done"), doneAt: v.number(), doneBy: UserIdSchema }),
  ]),
  dueOn: v.nullable(DueDateSchema),
  assignee: v.nullable(MemberSchema),
  createdAt: v.number(),
  updatedAt: v.number(),
  addedBy: AuthorSchema,
});

const MemberListSchema = v.object({ members: v.array(MemberSchema) });
const ProjectListSchema = v.object({ projects: v.array(ProjectSchema) });
const ProjectEnvelopeSchema = v.object({ project: ProjectSchema });
const ProjectDetailSchema = v.object({ project: ProjectSchema, tasks: v.array(TaskSchema) });
const TaskEnvelopeSchema = v.object({ task: TaskSchema });
const DeletedProjectSchema = v.object({ id: ProjectIdSchema });
const DeletedTaskSchema = v.object({ id: TaskIdSchema });

export class TodoApiError extends Error {
  readonly status: number;

  constructor(status: number, body: string) {
    super(body || `HTTP ${status}`);
    this.name = "TodoApiError";
    this.status = status;
  }
}

const parseJson = async <T>(res: Response, schema: v.GenericSchema<unknown, T>): Promise<T> => {
  if (!res.ok) throw new TodoApiError(res.status, await res.text());
  const raw: unknown = await res.json();
  return v.parse(schema, raw);
};

const jsonInit = (method: string, body: unknown, idempotencyKey?: string): RequestInit => ({
  method,
  credentials: "include",
  headers:
    idempotencyKey === undefined
      ? { "content-type": "application/json" }
      : { "content-type": "application/json", "idempotency-key": idempotencyKey },
  body: JSON.stringify(body),
});

const projectPath = (id: ProjectId): string => `/api/todo/projects/${encodeURIComponent(id)}`;
const taskPath = (id: TaskId): string => `/api/todo/tasks/${encodeURIComponent(id)}`;

export const fetchMembers = async (): Promise<TodoMember[]> => {
  const res = await fetch("/api/todo/members", { credentials: "include" });
  return [...(await parseJson(res, MemberListSchema)).members];
};

export const fetchProjects = async (): Promise<Project[]> => {
  const res = await fetch("/api/todo/projects", { credentials: "include" });
  const body = await parseJson(res, ProjectListSchema);
  return [...body.projects];
};

export const fetchProject = async (id: ProjectId): Promise<ProjectWithTasks> => {
  const res = await fetch(projectPath(id), { credentials: "include" });
  const body = await parseJson(res, ProjectDetailSchema);
  return { project: body.project, tasks: [...body.tasks] };
};

export const createProject = async (
  input: CreateProjectInput,
  idempotencyKey: string,
): Promise<Project> => {
  const res = await fetch("/api/todo/projects", jsonInit("POST", input, idempotencyKey));
  return (await parseJson(res, ProjectEnvelopeSchema)).project;
};

export const updateProject = async (id: ProjectId, input: UpdateProjectInput): Promise<Project> => {
  const res = await fetch(projectPath(id), jsonInit("PATCH", input));
  return (await parseJson(res, ProjectEnvelopeSchema)).project;
};

export const deleteProject = async (id: ProjectId): Promise<void> => {
  const res = await fetch(projectPath(id), { method: "DELETE", credentials: "include" });
  if (res.status === 404) return;
  const body = await parseJson(res, DeletedProjectSchema);
  if (body.id !== id) throw new Error("delete: id mismatch");
};

export const createTask = async (
  projectId: ProjectId,
  input: CreateTaskInput,
  idempotencyKey: string,
): Promise<Task> => {
  const res = await fetch(
    `${projectPath(projectId)}/tasks`,
    jsonInit("POST", input, idempotencyKey),
  );
  return (await parseJson(res, TaskEnvelopeSchema)).task;
};

export const setTaskDone = async (id: TaskId, done: boolean): Promise<Task> => {
  const res = await fetch(taskPath(id), jsonInit("PATCH", { done }));
  return (await parseJson(res, TaskEnvelopeSchema)).task;
};

export const updateTask = async (id: TaskId, input: UpdateTaskInput): Promise<Task> => {
  const res = await fetch(`${taskPath(id)}/content`, jsonInit("PATCH", input));
  return (await parseJson(res, TaskEnvelopeSchema)).task;
};

export const deleteTask = async (id: TaskId): Promise<void> => {
  const res = await fetch(taskPath(id), { method: "DELETE", credentials: "include" });
  if (res.status === 404) return;
  const body = await parseJson(res, DeletedTaskSchema);
  if (body.id !== id) throw new Error("delete: id mismatch");
};
