# app-grocery

Owns the grocery list feature end-to-end. Exports FOUR subpaths:

- `./shared` — isomorphic; safe for browser + server + MCP
- `./server` — Drizzle schema, Hono sub-router, service layer
- `./tools` — MCP tool registrar
- `./ui` — React components (re-usable across entry-points)

## Local rules

- Item status is `{ kind: "pending" } | { kind: "purchased"; … } |
  { kind: "removed"; … }`, in `src/shared/state.ts`. Stored as JSON.
  Never reduce to a string.
- ALL transitions go through `transition()` in `src/shared/state.ts`.
  Called by: `src/server/service.ts`, `src/tools/index.ts`, AND `apps/web`
  (optimistic updates). DO NOT FORK IT.
- Service returns `Result<T, GroceryError>`; routes match with `.exhaustive()`.
- Migrations: `bun run db:generate`, never hand-written SQL.
- The author column (`added_by_user_id`) is nullable and `ON DELETE SET NULL`,
  never cascade: the list is shared by the household, so removing one member
  must not delete what they added. A missing author serializes as `{ kind: "unknown" }`.
- Valibot schemas in `src/shared/validation.ts`. Used by routes AND TanStack
  Form (Standard Schema).
- UI components in `src/ui/` must pass `.claude/rules/mobile.md` and use
  shadcn primitives from `apps/web/src/components/ui` where possible.
- Component sizes: prefer `min-h-12` for primary inputs/buttons; the
  shadcn defaults are desktop-sized.
