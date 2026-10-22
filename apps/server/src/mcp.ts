import type {
  CleanupScheduler,
  GroceryAnnouncer,
  GroceryService,
} from "@hejmly/app-grocery/server";
import { registerGroceryTools } from "@hejmly/app-grocery/tools";
import type { RecipeService } from "@hejmly/app-recipes/server";
import { registerRecipeTools } from "@hejmly/app-recipes/tools";
import type { TodoService } from "@hejmly/app-todo/server";
import { registerTodoTools } from "@hejmly/app-todo/tools";
import type { AuditRecorder, MembershipService } from "@hejmly/core/server";
import {
  createAuthServerMetadataHandler,
  createMcpAuthGuard,
  createProtectedResourceMetadataHandler,
  deriveMcpAuthConfig,
  mcpHostGuard,
  runMcpRequest,
} from "@hejmly/core/server";
import { Hono } from "hono";
import { cors } from "hono/cors";

export type McpDeps = {
  authHandler: (req: Request) => Promise<Response>;
  membership: MembershipService;
  baseURL: string;
  jwksOrigin: string;
  allowedHosts: readonly string[];
  grocery: GroceryService;
  recipes: RecipeService;
  todo: TodoService;
  audit: AuditRecorder;
  cleanup: CleanupScheduler;
  announcer: GroceryAnnouncer;
};

export const mountMcp = ({
  authHandler,
  membership,
  baseURL,
  jwksOrigin,
  allowedHosts,
  grocery,
  recipes,
  todo,
  audit,
  cleanup,
  announcer,
}: McpDeps) => {
  const config = deriveMcpAuthConfig(baseURL, jwksOrigin);
  const handle = createMcpAuthGuard(
    config,
    membership,
  )((req, actor) =>
    runMcpRequest((server) => {
      registerGroceryTools(server, { service: grocery, actor, audit, cleanup, announcer });
      registerRecipeTools(server, { service: recipes, actor, audit });
      registerTodoTools(server, { service: todo, actor, audit });
    }, req),
  );

  const authServerMetadata = createAuthServerMetadataHandler(baseURL, authHandler);
  const protectedResourceMetadata = createProtectedResourceMetadataHandler(
    config.audience,
    config.issuer,
  );

  return new Hono()
    .get("/.well-known/oauth-authorization-server", () =>
      authServerMetadata("oauth-authorization-server"),
    )
    .get("/.well-known/oauth-authorization-server/api/auth", () =>
      authServerMetadata("oauth-authorization-server"),
    )
    .get("/.well-known/openid-configuration", () => authServerMetadata("openid-configuration"))
    .get("/.well-known/openid-configuration/api/auth", () =>
      authServerMetadata("openid-configuration"),
    )
    .get("/.well-known/oauth-protected-resource", () => protectedResourceMetadata())
    .get("/.well-known/oauth-protected-resource/mcp", () => protectedResourceMetadata())
    .use(
      "/mcp",
      cors({
        origin: "*",
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "mcp-session-id",
          "mcp-protocol-version",
          "Last-Event-ID",
        ],
        exposeHeaders: ["mcp-session-id", "mcp-protocol-version", "WWW-Authenticate"],
      }),
    )
    .use("/mcp", mcpHostGuard(allowedHosts))
    .all("/mcp", (c) => handle(c.req.raw));
};
