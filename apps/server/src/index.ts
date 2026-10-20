import { dirname, resolve } from "node:path";
import { createCleanupScheduler, createGroceryService } from "@hejmly/app-grocery/server";
import { createRecipeService } from "@hejmly/app-recipes/server";
import { createTodoService } from "@hejmly/app-todo/server";
import {
  createAssistantsService,
  createAuditRecorder,
  createAuth,
  createDb,
  parseAllowedEmails,
} from "@hejmly/core/server";
import { parseRuntimeEnv } from "@hejmly/core/shared";
import { createApp } from "./composition.ts";

const env = parseRuntimeEnv(process.env);

const staticRoot = resolve(import.meta.dirname, "../../web/dist");

const mcpResource = `${env.BETTER_AUTH_URL}/mcp`;
const allowedHosts = [
  new URL(env.BETTER_AUTH_URL).host,
  `localhost:${env.PORT}`,
  `127.0.0.1:${env.PORT}`,
  ...(env.MCP_HOST === undefined ? [] : [env.MCP_HOST]),
];

const db = createDb({ path: env.DATABASE_PATH });

const auth = createAuth({
  db,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  google: { clientId: env.GOOGLE_ID, clientSecret: env.GOOGLE_SECRET },
  allowedEmails: parseAllowedEmails(env.HEJMLY_ALLOWED_EMAILS),
  useSecureCookies: process.env.NODE_ENV === "production",
  mcpResource,
});

const groceryService = createGroceryService(db);
const recipeService = createRecipeService(db);
const todoService = createTodoService(db);
const assistantsService = createAssistantsService(db);
const audit = createAuditRecorder(db);
const cleanup = createCleanupScheduler({
  service: groceryService,
  dataPath: resolve(dirname(env.DATABASE_PATH), "grocery-cleanup.db"),
});

const app = createApp({
  auth,
  db,
  baseURL: env.BETTER_AUTH_URL,
  jwksOrigin: `http://localhost:${env.PORT}`,
  allowedHosts,
  staticRoot,
  audit,
  assistants: { service: assistantsService },
  grocery: { service: groceryService, cleanup },
  recipes: { service: recipeService },
  todo: { service: todoService },
});

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Hejmly server received ${signal}, shutting down`);
  await cleanup.close();
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.info(`Hejmly server listening on http://localhost:${env.PORT}`);
