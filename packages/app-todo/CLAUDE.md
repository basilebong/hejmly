# app-todo

Owns the to-do feature end-to-end: **projects**, each holding **tasks**.
Exports FOUR subpaths (mirrors `app-grocery`):

- `./shared` — isomorphic; branded `ProjectId` / `TaskId`, the task status
  state machine, `Project` / `Task` types, Valibot validation, the form-draft
  parsers (`parseProjectDraft`, `diffTaskDraft`, …) and `countTasks`.
- `./server` — Drizzle `todo_projects` + `todo_tasks` schema, a service
  returning `Result<T, TodoError>`, and Hono routes mounted at `/api/todo`.
- `./tools` — MCP `todo__*` tools (projects and tasks).
- `./ui` — React components: project rows with progress, task rows + actions
  menu, the project header, add/edit forms, skeletons.

## Local rules

- Task status is `{ kind: "open" } | { kind: "done"; doneAt; doneBy }`, stored
  as JSON in `status_json`; `completed_at` mirrors `doneAt` only so counts and
  indexes don't parse JSON. Keep the two in sync — only the service writes them.
- ALL status changes go through `transition()` in `src/shared/state.ts`.
  Called by `src/server/service.ts` AND `apps/web` (optimistic updates).
  DO NOT FORK IT.
- `todo_tasks.project_id` is `ON DELETE CASCADE`: deleting a project deletes
  its tasks. The service relies on that; don't delete tasks by hand first.
- Author columns (`created_by_user_id`, `added_by_user_id`) are nullable and
  `ON DELETE SET NULL`, never cascade: projects are shared, so removing one
  member must not delete what others put in them. A missing author serializes
  as `{ kind: "unknown" }`.
- Whitespace-only description/notes are stored as `null` (`blankToNull` in the
  service), so HTTP and MCP agree.
- IDs come from a per-service `monotonicFactory()` ULID so rows created in the
  same millisecond still order deterministically by `(created_at, id)`.
- `Project.taskCounts` is computed by the server. Screens that hold the task
  list (project detail) derive counts with `countTasks` so optimistic edits
  stay consistent.
- Form validation lives in `src/shared/drafts.ts` (pure, unit-tested); the
  `ui/` forms only render and delegate to it.
- Optimistic creates use local `tmp_` ids from `src/shared/local-rows.ts`. The
  web `queryFn`s merge server data with cached local rows (`mergeServerRows`)
  and hide rows with a delete in flight, so refetches never drop a pending
  create or resurrect a pending delete. A local row's state comes from the
  mutation cache (`localRowStates`), not component state; a local row with no
  live attempt is retryable. Retry reuses the same local id, which is also the
  `Idempotency-Key`, and `settleLocalRow` de-duplicates a replayed create.
- In `apps/web`, every project-screen mutation is keyed under
  `["todo", "project", id]`; `onSettled` refetches the detail only when it is
  the last one in flight, and rollbacks restore only what that mutation
  changed.
- MCP failures return `structuredContent: { error }` and are audited with the
  error kind, like successes.
- Migrations: `bun run db:generate`, never hand-written SQL.
- UI components in `src/ui/` must pass `.claude/rules/mobile.md`; the progress
  bar is Radix `@radix-ui/react-progress`, the menus Radix dropdown-menu.
