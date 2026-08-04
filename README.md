# Hejmly

![version: v0.0.1](https://img.shields.io/badge/version-v0.0.1-blue)

<p align="center">
  <img src="docs/thumbnail.png" alt="Hejmly recipes screen" width="520">
</p>

<p align="center">Your family's groceries and recipes in one private app you own, and that Claude can manage for you.</p>

- **Groceries and recipes** for the whole household, synced across everyone's phones
- **Installs like a native app** and keeps working offline (PWA)
- **Claude built in**: a secure MCP server lets you manage your lists and recipes by chat
- **Private by design**: runs on your own server, sign-in limited to your family
- **One login** for a growing set of small family apps (grocery and recipes today)

Under the hood: a single Bun process in one Docker image, deployed behind a
reverse proxy like Caddy. You own the deployment and the data.

License: [Elastic License 2.0](./LICENSE). Free to self-host, use, modify, and
redistribute. You may not offer it to others as a hosted or managed service;
that requires a separate commercial license (contact us).

---

## Stack

- **Runtime:** Bun (latest stable)
- **HTTP:** Hono v4 (serves API + MCP + static React in one process)
- **Frontend:** React 19 + Vite + TanStack (Router, Query, Form) + Tailwind v4
- **UI:** shadcn/ui (copy-paste, in `apps/web/src/components/ui/`) + Vaul
  (drawers) + Sonner (toasts) + Phosphor Icons
- **DB:** `bun:sqlite` via Drizzle ORM (beta)
- **Auth:** Better Auth, with Google sign-in (+ One Tap) for people; an OAuth 2.1
  provider (`@better-auth/oauth-provider` + JWT) for MCP clients like Claude
- **Validation:** Valibot at HTTP boundaries, Zod inside MCP tool defs only
- **Tests:** `bun:test`; Playwright for end-to-end
- **Package manager:** pnpm 11 (hardened defaults, see `.npmrc` and
  `pnpm-workspace.yaml`)

## Layout

```
onehouse/
├── apps/                            # Leaves in the import DAG (nothing imports these)
│   ├── server/                      # Single Bun runtime. Composition only.
│   │   └── src/
│   │       ├── composition.ts
│   │       └── composition.test.ts  # ← tests sit next to the code they cover
│   └── web/                         # React + Vite + PWA
│       ├── src/{components,features,routes,lib}/
│       └── e2e/                     # Playwright, the only non-colocated tests
├── packages/                        # Internal libraries, imported by apps and each other
│   ├── core/                        # Platform plumbing
│   │   └── src/
│   │       ├── shared/              # Branded IDs, Result, isomorphic helpers (browser-safe)
│   │       │   ├── ids.ts
│   │       │   └── ids.test.ts
│   │       └── server/              # Better Auth, db, MCP plumbing, middleware
│   ├── app-grocery/                 # Grocery list; four subpaths enforce the boundary
│   │   └── src/
│   │       ├── shared/              # State machines, Valibot, types (browser-safe)
│   │       ├── server/              # Drizzle schema, Hono routes, services
│   │       ├── tools/               # MCP tool definitions
│   │       └── ui/                  # React components reused across entry points
│   └── app-recipes/                 # Recipes; same four-subpath structure
├── drizzle/                         # Generated migrations (committed)
├── data/                            # SQLite + WAL (Docker volume)
├── scripts/                         # migrate.ts, backup, etc.
├── .claude/                         # Agent rules (root + per-topic)
└── .github/workflows/               # CI + deploy
```

Unit and integration tests are **colocated**: `foo.test.ts` lives next to
`foo.ts` in the same directory. The only exception is Playwright E2E, which
runs against the built Docker image and lives in `apps/web/e2e/`.

Each `packages/app-*` exports four subpaths:

| Path        | What                                          | Browser? |
|-------------|-----------------------------------------------|----------|
| `./shared`  | state machines, types, Valibot schemas        | yes      |
| `./server`  | Drizzle schema, Hono routes, services         | no       |
| `./tools`   | MCP tool definitions                          | no       |
| `./ui`      | React components reusable across entry points | yes      |

The frontend imports `/shared` and `/ui` only. Importing `/server` or `/tools`
from browser code fails to type-check.

## Prerequisites

- [Bun](https://bun.sh) (latest stable)
- [pnpm](https://pnpm.io) 11+ (`npm install -g pnpm@latest`)
- Docker + Docker Compose (for the dev container or prod build)
- A Google Cloud project with an OAuth 2.0 Client ID (for sign-in)

## Getting started

```bash
# 1. Install (uses pnpm; Bun runs the code)
pnpm install

# 2. Configure
cp .env.example .env
# edit .env, see "Auth setup" below

# 3. Install git hooks (one-time; lefthook writes .git/hooks/*; `.npmrc`
#    has `ignore-scripts=true`, so this is NOT done automatically by install)
pnpm hooks:install

# 4. Run pending migrations (auth schema is committed, drizzle/0000_*.sql too)
pnpm db:migrate

# 5. Dev (host): server (3000) + Vite (5173) with hot reload
pnpm dev

# OR Dev (Docker): bind-mounted hot reload
docker compose --profile dev up
```

Open <http://localhost:5173>.

## Auth setup

Sign-in goes through Google with an email allowlist enforced inside Better
Auth. Without the allowlist, a Google login is rejected with `403` before
any user row is created.

### Google OAuth Client ID (one-time per developer)

1. Open <https://console.cloud.google.com/apis/credentials>
2. Create an **OAuth 2.0 Client ID**, type **Web application**
3. Authorized JavaScript origins:
   - `http://localhost:5173` (local dev)
   - `https://<your-domain>` (production)
4. Authorized redirect URIs:
   - `http://localhost:5173/api/auth/callback/google` (local dev)
   - `https://<your-domain>/api/auth/callback/google` (production)
5. Copy the Client ID + Client Secret into `.env`:
   ```ini
   GOOGLE_ID=<client id>
   GOOGLE_SECRET=<client secret>
   ```

In production, set `BETTER_AUTH_URL` to your public origin (e.g.
`https://<your-domain>`). Google sends its redirect back to `BETTER_AUTH_URL`,
and a mismatch breaks sign-in.

### `.env` (auth-relevant fields)

```ini
BETTER_AUTH_URL=http://localhost:5173          # public origin (prod: https://<your-domain>)
BETTER_AUTH_SECRET=<openssl rand -hex 32>       # 32+ random hex chars

GOOGLE_ID=<from Google Cloud>
GOOGLE_SECRET=<from Google Cloud>

# Comma-separated allowlist. Sign-in is rejected for any other email.
# Matched case-insensitively after trimming.
HEJMLY_ALLOWED_EMAILS=basile@example.com,partner@example.com

# Public Host the MCP endpoint is reached at (DNS-rebinding allowlist). The
# server also allows the BETTER_AUTH_URL host + localhost:$PORT automatically,
# so local dev needs no change. In prod set it to your domain.
MCP_HOST=localhost                              # public MCP host (prod: <your-domain>)

DATABASE_PATH=./data/app.db
```

`BETTER_AUTH_URL` is the user-visible origin. In dev it's the Vite server
(`:5173`), which proxies `/api/*` → the Hono server on `$PORT`. Cookies are
scoped to that origin, so Google's redirect must come back there too.

### How the allowlist works

Better Auth runs `databaseHooks.user.create.before` immediately after Google
returns a verified profile, before any user row is inserted. The hook
checks the email against `HEJMLY_ALLOWED_EMAILS` (parsed once at boot)
and throws `APIError("FORBIDDEN")` if it isn't a match.

Result: an unauthorised email gets a `403` on the callback, the `users` /
`accounts` / `sessions` tables stay clean, and no session cookie is issued.

To add a new family member:
1. Append their Google account email to `HEJMLY_ALLOWED_EMAILS` in `.env`
2. Restart the server (`pnpm dev` re-reads env on `bun --hot` restart)
3. They click "Continue with Google"

### Local sign-in flow (what you'll see)

1. `pnpm dev` (or `docker compose --profile dev up`)
2. Open <http://localhost:5173>
3. Click "Continue with Google"
4. Approve on Google's screen
5. Redirected back to `/`; subsequent `/api/*` requests carry the
   `Hejmly.session_token` cookie

If you're not on the allowlist, step 5 returns `403`; the URL will show
the Better Auth error code. Fix: add your email to `HEJMLY_ALLOWED_EMAILS`
and try again.

## Connecting from Claude (MCP)

The apps are exposed to Claude (Desktop or claude.ai) as a remote MCP
server at `/mcp`, secured with OAuth 2.1. Better Auth is the authorization
server: Claude self-registers via Dynamic Client Registration, you sign in with
Google and approve a consent screen (`/consent`), and Claude receives a scoped
bearer token. Each tool call is recorded in the audit log as `{ userId, via: "mcp" }`.

Grocery tools: `grocery__list_items`, `grocery__add_item`, `grocery__mark_purchased`,
`grocery__mark_pending`, `grocery__update_item`, `grocery__remove_item`.

Recipes tools: `recipes__list`, `recipes__add`, `recipes__get`, `recipes__update`,
`recipes__remove`.

### Test locally with the MCP Inspector

```bash
pnpm dev                                  # Hono :3000 + Vite :5173
pnpm dlx @modelcontextprotocol/inspector  # opens the Inspector UI
```

Connect to `http://localhost:5173/mcp` (transport: Streamable HTTP). The
Inspector runs the OAuth flow in your browser: Google sign-in → `/consent` →
back, then lists and calls the tools. `localhost` is exempt from the
MCP HTTPS requirement, so no TLS is needed locally.

### Add it to Claude Desktop / claude.ai

Settings → Connectors → "Add custom connector", URL `https://<your-domain>/mcp`.
Set `BETTER_AUTH_URL=https://<your-domain>` and `MCP_HOST=<your-domain>` (behind
Caddy). Claude finds the OAuth endpoints via
`/.well-known/oauth-protected-resource`, registers itself, and walks you through
the same Google sign-in + consent. Remote connectors require HTTPS.

## Common commands

| Command                    | What                                            |
|----------------------------|-------------------------------------------------|
| `pnpm dev`                 | Server + Vite, hot reload                       |
| `pnpm test`                | `bun test`                                      |
| `pnpm typecheck`           | `tsc -b --noEmit` across the workspace          |
| `pnpm check`               | Biome lint + format check (incl. import order)  |
| `pnpm check:source`        | No-bare-`as` (TS AST)                           |
| `pnpm lint:fix`            | Biome auto-fix (organizes imports, etc.)        |
| `pnpm hooks:install`       | Install lefthook git hooks (one-time)           |
| `pnpm auth:generate`       | Regenerate Better Auth Drizzle schema; commit   |
| `pnpm db:generate`         | Generate Drizzle migration from schema diff     |
| `pnpm db:migrate`          | Apply pending migrations                        |
| `pnpm license:check`       | Verify all deps are permissive (MIT/Apache/BSD) |
| `bunx shadcn@latest add X` | Add a shadcn component (run in `apps/web`)      |

## Building & running production

```bash
docker build --target runtime -t hejmly .
docker run -v ./data:/data --env-file .env -p 3000:3000 hejmly
```

Or via compose (default profile is `prod`):

```bash
docker compose up -d
```

The production image runs one Bun process serving `/api/auth/*`, `/api/*`,
`/mcp`, and the static React bundle.

## Hooks

Managed by [lefthook](https://github.com/evilmartians/lefthook) (`lefthook.yml`).
Run `pnpm hooks:install` once after `pnpm install` (`.npmrc` has
`ignore-scripts=true`, so lefthook does NOT install itself automatically).

`pre-commit` (parallel):
- Biome lint + format on staged `.ts`/`.tsx`/`.json`/`.css` (auto-fix, re-stages)
- `check-source` AST check (no bare `as`) on staged `.ts`/`.tsx`
- `tsc -b --noEmit` across the workspace (types are cross-file)

## Mobile-first

Every UI component is designed for a 360×780 viewport first and adapts up via
Tailwind breakpoints. Drawer (Vaul) is the default modal pattern; centered
Dialog is desktop-only. Full checklist in `.claude/rules/mobile.md`.

## Agent rules

Working with Claude Code? Read `.claude/CLAUDE.md` first. Per-topic rules live
in `.claude/rules/`. `AGENTS.md` is a symlink to the root rules for cross-tool
compatibility.

## Adding a new app

1. `mkdir packages/app-<name>`, copy the `app-grocery` skeleton
2. Add tables in `src/server/schema.ts`, then `pnpm db:generate`
3. State machine in `src/shared/state.ts`; Valibot schemas in
   `src/shared/validation.ts`
4. Add the four `exports` subpaths to `package.json`
5. Three one-liners:
   - `apps/server/src/composition.ts` → `.route("/api/<name>", routes)`
   - `apps/server/src/mcp.ts` → `register<Name>Tools(server, ctx)`
   - `apps/web/src/router.tsx` → register `/<name>` routes
6. Rebuild image, deploy

No core changes required.
