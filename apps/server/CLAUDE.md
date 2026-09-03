# apps/server

SINGLE runtime entry-point. Serves API + Better Auth + MCP + static React.
Composition only — NO business logic.

## Hard rules
- Better Auth handler mounted at `/api/auth/*` MUST come BEFORE any middleware
  that calls `auth.api.getSession`.
- `requireSession` gates `/api/*` (browser sessions).
- `/mcp` is gated by the OAuth token guard (`createMcpAuthGuard`, built on
  `oauthProviderResourceClient().verifyAccessTokenRequest`), NOT by
  `requireSession` — so it is mounted OUTSIDE `/api/*` (see `mcp.ts`).
  The root `/.well-known/oauth-*` discovery routes are public; the two
  authorization-server documents re-serve the OAuth Provider plugin's own
  output rather than restating it.
- The MCP transport is the SDK's `WebStandardStreamableHTTPServerTransport`.
  DNS-rebinding protection is enforced by the `mcpHostGuard` middleware in front
  of `/mcp` (the SDK's transport-level option is deprecated). MCP SDK pinned to
  1.x with the CVE-2025-66414 fix.
- Static assets via `serveStatic` LAST — catch-all must not shadow API/MCP.
- Migrations run from the Docker entrypoint, NOT from this file.
