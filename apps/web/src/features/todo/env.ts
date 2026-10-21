import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useSessionAuthor } from "@/lib/session-author";
import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  fetchProject,
  fetchProjects,
  setTaskDone,
  updateProject,
  updateTask,
} from "@/lib/todo-api";
import type { TodoApi, TodoCacheEnv } from "./cache.ts";

const todoApi: TodoApi = {
  fetchProjects,
  fetchProject,
  createProject,
  updateProject,
  deleteProject,
  createTask,
  setTaskDone,
  updateTask,
  deleteTask,
};

const notify = {
  error: (message: string) => {
    toast.error(message);
  },
  info: (message: string) => {
    toast.info(message);
  },
  success: (message: string) => {
    toast.success(message);
  },
};

export const useTodoCacheEnv = (): TodoCacheEnv => {
  const qc = useQueryClient();
  const identity = useSessionAuthor();
  return { qc, api: todoApi, online: () => navigator.onLine, notify, author: () => identity };
};
