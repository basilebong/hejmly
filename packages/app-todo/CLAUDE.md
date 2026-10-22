# app-todo

Owns the to-do feature end-to-end: **projects**, each holding **tasks**.
Exports FOUR subpaths (mirrors `app-grocery`):

- `./shared` — isomorphic; branded `ProjectId` / `TaskId`, the task status
  state machine, `Project` / `Task` types, Valibot validation, the form-draft
  parsers (`parseProjectDraft`, `diffTaskDraft`, …) and `countTasks`.
- `./server` — Drizzle `todo_projects` + `todo_tasks` schema, a service
  returning `Result<T, TodoError>`, and Hono routes mounted at `/api/todo`.
- `./tools` — MCP `todo__*` tools (members, projects and tasks).
- `./ui` — React components: project rows with progress, task rows, the task
  detail view, the project header, add/edit forms (due date + member
  pickers), skeletons.

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
- `due_on` is a calendar day (`YYYY-MM-DD`, branded `DueDate`), never a
  timestamp: no time, no time zone. `DueDateSchema` rejects days that don't
  exist (`2026-02-30`); `isoDate` alone does not. "Today" is the viewer's local
  day (`localDueDate`), so overdue/today are computed on the client, never
  stored. Open tasks are shown dated-first, soonest first (`orderOpenTasks`).
- `assignee_user_id` is nullable and `ON DELETE SET NULL`, like the author
  columns. Only household members can be assigned: the service checks
  `isMember(email)` (the server passes the `HEJMLY_ALLOWED_EMAILS` allowlist)
  and returns `member_not_found` otherwise, so a former member whose user row
  still exists can't be assigned. `GET /api/todo/members` and
  `todo__list_members` list exactly the assignable people.
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
  mutation cache (`localRowStates`), not component state, as a
  `{ kind: "synced" | "queued" | "error" }` union; a local row with no live
  attempt (e.g. after a reload) is retryable. Retry reuses the same local id,
  which is also the `Idempotency-Key`, and `settleLocalRow` de-duplicates a
  replayed create. The persisted query cache is dropped on every deploy (the
  buster is the build time), so unsynced failed rows do not survive a deploy.
- All web query/mutation options live in `apps/web/src/features/todo/cache.ts`
  (tested in `cache.test.ts` against a real `QueryClient`). Project-screen
  mutations are keyed under `["todo", "project", id]`. Refreshes after a
  mutation are scheduled by `refreshAfterSettle`, never awaited in `onSettled`:
  TanStack only leaves "pending" after `onSettled` resolves, so refetching
  inside it would re-hide a row a failed delete just restored and would let
  concurrent settles each skip the refetch. Rollbacks restore only the fields
  that mutation changed.
- MCP failures return `structuredContent: { error }` and are audited with the
  error kind, like successes.
- Migrations: `bun run db:generate`, never hand-written SQL. drizzle-kit
  0.31.10 drops `ON DELETE` when it ADDs a column with a foreign key in SQLite
  (`ALTER TABLE … ADD … REFERENCES t(c)`, see `SQLiteAlterTableAddColumnConvertor`).
  Add such a column in two generated steps: first without `.references()`,
  then with it, which makes drizzle-kit rebuild the table and keep the delete
  rule (0011 + 0012). The migration tests check the resulting
  `pragma_foreign_key_list`.
- UI components in `src/ui/` must pass `.claude/rules/mobile.md`; the progress
  bar is Radix `@radix-ui/react-progress`, the menus Radix dropdown-menu, the
  member picker Radix radio-group. Task actions live in the detail drawer
  (tap a row), not in a per-row menu.
