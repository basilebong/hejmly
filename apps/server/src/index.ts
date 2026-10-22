import { dirname, resolve } from "node:path";
import {
  createCleanupScheduler,
  createGroceryAnnouncer,
  createGroceryService,
} from "@hejmly/app-grocery/server";
import { createRecipeService } from "@hejmly/app-recipes/server";
import { createDueReminders, createTodoService } from "@hejmly/app-todo/server";
import {
  createAssistantsService,
  createAuditRecorder,
  createAuth,
  createDb,
  createMembershipService,
  createPushService,
  fetchPushSender,
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
const allowedEmails = parseAllowedEmails(env.HEJMLY_ALLOWED_EMAILS);

const auth = createAuth({
  db,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  google: { clientId: env.GOOGLE_ID, clientSecret: env.GOOGLE_SECRET },
  allowedEmails,
  useSecureCookies: process.env.NODE_ENV === "production",
  mcpResource,
});

const membership = createMembershipService({ auth, db, allowedEmails });
const revocation = await membership.revokeFormerMembers();
if (revocation.kind === "err") {
  console.error(`Hejmly server could not revoke former members: ${revocation.error.message}`);
  process.exit(1);
}
if (revocation.value.revoked.length > 0) {
  console.info(
    `Hejmly server revoked sessions and assistant tokens of ${revocation.value.revoked.length} user(s) no longer on HEJMLY_ALLOWED_EMAILS`,
  );
}

const groceryService = createGroceryService(db);
const recipeService = createRecipeService(db);
const todoService = createTodoService(db, { isMember: membership.allowsEmail });
const assistantsService = createAssistantsService(db);
const audit = createAuditRecorder(db);
const pushService = createPushService(db, {
  isMember: membership.allowsEmail,
  subject: env.BETTER_AUTH_URL,
  send: fetchPushSender(),
});
const jobsDataPath = resolve(dirname(env.DATABASE_PATH), "grocery-cleanup.db");
const cleanup = createCleanupScheduler({ service: groceryService, dataPath: jobsDataPath });
const announcer = createGroceryAnnouncer({
  service: groceryService,
  push: pushService,
  dataPath: jobsDataPath,
});
const dueReminders = createDueReminders({
  service: todoService,
  push: pushService,
  timeZone: env.HEJMLY_TIMEZONE,
  dataPath: jobsDataPath,
});

const app = createApp({
  auth,
  membership,
  db,
  baseURL: env.BETTER_AUTH_URL,
  jwksOrigin: `http://localhost:${env.PORT}`,
  allowedHosts,
  staticRoot,
  audit,
  assistants: { service: assistantsService },
  grocery: { service: groceryService, cleanup, announcer },
  push: { service: pushService },
  recipes: { service: recipeService },
  todo: { service: todoService },
});

const server = Bun.serve({ port: env.PORT, fetch: app.fetch });

let shuttingDown = false;
const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Hejmly server received ${signal}, shutting down`);
  await dueReminders.close();
  await announcer.close();
  await cleanup.close();
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.info(`Hejmly server listening on http://localhost:${env.PORT}`);
