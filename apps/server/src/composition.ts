import type { CleanupScheduler, GroceryService } from "@hejmly/app-grocery/server";
import { createGroceryRoutes } from "@hejmly/app-grocery/server";
import type { RecipeService } from "@hejmly/app-recipes/server";
import { createRecipeRoutes } from "@hejmly/app-recipes/server";
import {
  type AssistantsService,
  type AuditRecorder,
  type Auth,
  createAssistantsRoutes,
  createIdempotency,
  createRequireSession,
  type Db,
} from "@hejmly/core/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { mountMcp } from "./mcp.ts";
import { mountStatic } from "./static.ts";

const isValidationError = (err: unknown): boolean =>
  err instanceof Error && err.name === "ValiError";

export type ComposeOptions = {
  auth: Auth;
  db: Db;
  baseURL: string;
  jwksOrigin: string;
  allowedHosts: readonly string[];
  staticRoot: string;
  audit: AuditRecorder;
  assistants: {
    service: AssistantsService;
  };
  grocery: {
    service: GroceryService;
    cleanup: CleanupScheduler;
  };
  recipes: {
    service: RecipeService;
  };
};

export const createApp = ({
  auth,
  db,
  baseURL,
  jwksOrigin,
  allowedHosts,
  staticRoot,
  audit,
  assistants,
  grocery,
  recipes,
}: ComposeOptions) =>
  new Hono()
    .use("*", logger())
    .use("*", secureHeaders())
    .use("/api/*", cors({ origin: baseURL, credentials: true }))
    .get("/healthz", (c) => c.json({ ok: true }))
    .on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))
    .route(
      "/",
      mountMcp({
        authHandler: (req) => auth.handler(req),
        baseURL,
        jwksOrigin,
        allowedHosts,
        grocery: grocery.service,
        recipes: recipes.service,
        audit,
        cleanup: grocery.cleanup,
      }),
    )
    .use("/api/*", createRequireSession(auth))
    .use("/api/*", createIdempotency(db))
    .get("/api/me", (c) => c.json({ user: c.get("user") }))
    .route("/api/me/assistants", createAssistantsRoutes({ service: assistants.service, audit }))
    .route("/api/grocery", createGroceryRoutes(grocery))
    .route("/api/recipes", createRecipeRoutes(recipes))
    .route("/", mountStatic(staticRoot))
    .onError((err, c) => {
      if (isValidationError(err)) {
        return c.json({ kind: "invalid_input", message: "Invalid input" }, 400);
      }
      console.error("unhandled route error", err);
      return c.json({ kind: "internal_error" }, 500);
    });

export type AppType = ReturnType<typeof createApp>;
