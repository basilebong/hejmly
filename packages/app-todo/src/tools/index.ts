import { type AuditRecorder, createToolAuditor } from "@hejmly/core/server";
import type { UserId } from "@hejmly/core/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { match } from "ts-pattern";
import * as z from "zod";
import type { TodoService } from "../server/index.ts";
import {
  ID_MAX_LENGTH,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  type Project,
  parseProjectId,
  parseTaskId,
  TASK_NOTES_MAX,
  TASK_TITLE_MAX,
  type Task,
  type TodoError,
} from "../shared/index.ts";

const idInput = z.string().min(1).max(ID_MAX_LENGTH);
export type TodoToolDeps = {
  service: TodoService;
  actor: UserId;
  audit: AuditRecorder;
};

const projectText = (p: Project): string => {
  const description = p.description === null ? "" : ` — ${p.description}`;
  return `${p.name}${description} [${p.taskCounts.open} open, ${p.taskCounts.done} done] (id: ${p.id})`;
};

const taskText = (t: Task): string => {
  const box = t.status.kind === "done" ? "[x]" : "[ ]";
  const notes = t.notes === null ? "" : ` — ${t.notes}`;
  return `${box} ${t.title}${notes} (id: ${t.id}, added by ${t.addedBy.name})`;
};

const errorText = (error: TodoError): string =>
  match(error)
    .with({ kind: "project_not_found" }, (e) => `No project found with id "${e.id}".`)
    .with({ kind: "task_not_found" }, (e) => `No task found with id "${e.id}".`)
    .with({ kind: "invalid_input" }, (e) => e.message)
    .with({ kind: "already_in_state" }, (e) => `Task is already ${e.state}.`)
    .exhaustive();

const projectResult = (text: string, project: Project) => ({
  content: [{ type: "text" as const, text }],
  structuredContent: { project },
});

const taskResult = (text: string, task: Task) => ({
  content: [{ type: "text" as const, text }],
  structuredContent: { task },
});

const projectName = z.string().trim().min(1).max(PROJECT_NAME_MAX);
const projectDescription = z.string().trim().max(PROJECT_DESCRIPTION_MAX);
const taskTitle = z.string().trim().min(1).max(TASK_TITLE_MAX);
const taskNotes = z.string().trim().max(TASK_NOTES_MAX);

export const registerTodoTools = (server: McpServer, deps: TodoToolDeps): void => {
  const { service, actor, audit } = deps;
  const auditor = createToolAuditor({ audit, actor, app: "todo" });

  server.registerTool(
    "todo__list_projects",
    {
      title: "List to-do projects",
      description:
        "List the household's to-do projects with how many tasks are open and done in each.",
      inputSchema: {},
    },
    async () => {
      const projects = await service.listProjects();
      await auditor.record("todo__list_projects", { count: projects.length });
      const text =
        projects.length === 0 ? "There are no projects yet." : projects.map(projectText).join("\n");
      return { content: [{ type: "text" as const, text }], structuredContent: { projects } };
    },
  );

  server.registerTool(
    "todo__add_project",
    {
      title: "Add to-do project",
      description: "Create a new to-do project. Tasks are added to a project with todo__add_task.",
      inputSchema: { name: projectName, description: projectDescription.optional() },
    },
    async ({ name, description }) => {
      const result = await service.createProject({ name, description }, actor);
      if (result.kind === "err")
        return auditor.failure("todo__add_project", result.error, errorText(result.error), {});
      await auditor.record("todo__add_project", { projectId: result.value.id });
      return projectResult(`Created project ${projectText(result.value)}.`, result.value);
    },
  );

  server.registerTool(
    "todo__update_project",
    {
      title: "Update to-do project",
      description: "Rename a project or change its description (null clears it).",
      inputSchema: {
        projectId: idInput,
        name: projectName.optional(),
        description: projectDescription.nullable().optional(),
      },
    },
    async ({ projectId, name, description }) => {
      const result = await service.updateProject(parseProjectId(projectId), { name, description });
      if (result.kind === "err")
        return auditor.failure("todo__update_project", result.error, errorText(result.error), {
          projectId,
        });
      await auditor.record("todo__update_project", { projectId: result.value.id });
      return projectResult(`Updated project ${projectText(result.value)}.`, result.value);
    },
  );

  server.registerTool(
    "todo__remove_project",
    {
      title: "Remove to-do project",
      description: "Permanently delete a project and every task in it.",
      inputSchema: { projectId: idInput },
    },
    async ({ projectId }) => {
      const result = await service.removeProject(parseProjectId(projectId));
      if (result.kind === "err")
        return auditor.failure("todo__remove_project", result.error, errorText(result.error), {
          projectId,
        });
      await auditor.record("todo__remove_project", { projectId: result.value.id });
      return {
        content: [{ type: "text" as const, text: `Removed project ${result.value.id}.` }],
        structuredContent: { id: result.value.id },
      };
    },
  );

  server.registerTool(
    "todo__list_tasks",
    {
      title: "List tasks in a project",
      description: "List the tasks in a to-do project, optionally filtered by status.",
      inputSchema: {
        projectId: idInput,
        status: z.enum(["open", "done", "all"]).optional(),
      },
    },
    async ({ projectId, status }) => {
      const result = await service.getProject(parseProjectId(projectId));
      if (result.kind === "err")
        return auditor.failure("todo__list_tasks", result.error, errorText(result.error), {
          projectId,
        });
      const { project } = result.value;
      const tasks =
        status === undefined || status === "all"
          ? result.value.tasks
          : result.value.tasks.filter((t) => t.status.kind === status);
      await auditor.record("todo__list_tasks", {
        projectId: project.id,
        status: status ?? "all",
        count: tasks.length,
      });
      const body = tasks.length === 0 ? "No matching tasks." : tasks.map(taskText).join("\n");
      return {
        content: [{ type: "text" as const, text: `${projectText(project)}\n${body}` }],
        structuredContent: { project, tasks },
      };
    },
  );

  server.registerTool(
    "todo__add_task",
    {
      title: "Add task",
      description: "Add a task to a to-do project.",
      inputSchema: {
        projectId: idInput,
        title: taskTitle,
        notes: taskNotes.optional(),
      },
    },
    async ({ projectId, title, notes }) => {
      const result = await service.createTask(parseProjectId(projectId), { title, notes }, actor);
      if (result.kind === "err")
        return auditor.failure("todo__add_task", result.error, errorText(result.error), {
          projectId,
        });
      await auditor.record("todo__add_task", {
        projectId: result.value.projectId,
        taskId: result.value.id,
      });
      return taskResult(`Added ${taskText(result.value)}.`, result.value);
    },
  );

  server.registerTool(
    "todo__complete_task",
    {
      title: "Complete task",
      description: "Mark a task as done.",
      inputSchema: { taskId: idInput },
    },
    async ({ taskId }) => {
      const result = await service.completeTask(parseTaskId(taskId), actor);
      if (result.kind === "err")
        return auditor.failure("todo__complete_task", result.error, errorText(result.error), {
          taskId,
        });
      await auditor.record("todo__complete_task", { taskId: result.value.id });
      return taskResult(`Completed "${result.value.title}".`, result.value);
    },
  );

  server.registerTool(
    "todo__reopen_task",
    {
      title: "Reopen task",
      description: "Move a done task back to open.",
      inputSchema: { taskId: idInput },
    },
    async ({ taskId }) => {
      const result = await service.reopenTask(parseTaskId(taskId));
      if (result.kind === "err")
        return auditor.failure("todo__reopen_task", result.error, errorText(result.error), {
          taskId,
        });
      await auditor.record("todo__reopen_task", { taskId: result.value.id });
      return taskResult(`Reopened "${result.value.title}".`, result.value);
    },
  );

  server.registerTool(
    "todo__update_task",
    {
      title: "Update task",
      description: "Change a task's title or notes (null clears the notes).",
      inputSchema: {
        taskId: idInput,
        title: taskTitle.optional(),
        notes: taskNotes.nullable().optional(),
      },
    },
    async ({ taskId, title, notes }) => {
      const result = await service.updateTask(parseTaskId(taskId), { title, notes });
      if (result.kind === "err")
        return auditor.failure("todo__update_task", result.error, errorText(result.error), {
          taskId,
        });
      await auditor.record("todo__update_task", { taskId: result.value.id });
      return taskResult(`Updated ${taskText(result.value)}.`, result.value);
    },
  );

  server.registerTool(
    "todo__remove_task",
    {
      title: "Remove task",
      description: "Permanently delete a task.",
      inputSchema: { taskId: idInput },
    },
    async ({ taskId }) => {
      const result = await service.removeTask(parseTaskId(taskId));
      if (result.kind === "err")
        return auditor.failure("todo__remove_task", result.error, errorText(result.error), {
          taskId,
        });
      await auditor.record("todo__remove_task", { taskId: result.value.id });
      return {
        content: [{ type: "text" as const, text: `Removed task ${result.value.id}.` }],
        structuredContent: { id: result.value.id },
      };
    },
  );
};
