import type { CleanupScheduler, GroceryService } from "@hejmly/app-grocery/server";
import { registerGroceryTools } from "@hejmly/app-grocery/tools";
import type { RecipeService } from "@hejmly/app-recipes/server";
import { registerRecipeTools } from "@hejmly/app-recipes/tools";
import type { AuditRecorder } from "@hejmly/core/server";
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
  baseURL: string;
  jwksOrigin: string;
  allowedHosts: readonly string[];
  grocery: GroceryService;
  recipes: RecipeService;
  audit: AuditRecorder;
  cleanup: CleanupScheduler;
};

export const mountMcp = ({
  authHandler,
  baseURL,
  jwksOrigin,
  allowedHosts,
  grocery,
  recipes,
  audit,
  cleanup,
}: McpDeps) => {
  const config = deriveMcpAuthConfig(baseURL, jwksOrigin);
  const handle = createMcpAuthGuard(config)((req, actor) =>
    runMcpRequest((server) => {
      registerGroceryTools(server, { service: grocery, actor, audit, cleanup });
      registerRecipeTools(server, { service: recipes, actor, audit });
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
