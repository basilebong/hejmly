# app-recipes

Owns the recipes feature end-to-end. Exports FOUR subpaths (mirrors
`app-grocery`):

- `./shared` — isomorphic; branded `RecipeId`, recipe/ingredient/step types,
  the `Starter|Main|Dessert|Other` category, the timer state machine, duration
  formatting, the `defaultGrocerySelection` helper, and Valibot create-recipe
  validation (including the data-URL `image`, size-capped).
- `./server` — Drizzle `recipes` schema (ingredients/steps stored as validated
  JSON, optional `image` data URL in its own column), a service returning
  `Result`, and Hono routes.
- `./tools` — MCP `recipes__list` / `__get` / `__add` / `__update` / `__remove`.
- `./ui` — React components (recipe detail pieces, ingredient rows, the tappable
  `TimeChip` for the steps list + the big `CookTimeButton` for focused cook mode,
  the `useTimers` hook, the floating timer stack, the `PhotoInput` uploader
  (client-side canvas resize), `exportRecipePdf`, browse cards).

Recipes are real persisted rows — authored via the web create form or MCP, not
seeded. The recipe photo is an optional data URL the browser resizes before
upload; it lives on the full `Recipe`, never on the list `RecipeSummary`.

## Local rules

- Timer logic is a pure state machine in `src/shared/timers.ts`: `startTimer`,
  `cancelTimer`, and the `viewTimer` selector. The UI `useTimers` hook is the
  only place `Date.now()` is read; the reducer always takes `now` as a
  parameter so it stays testable. DO NOT FORK IT.
- The author column (`created_by_user_id`) is nullable and `ON DELETE SET NULL`,
  never cascade: the recipe book is shared by the household, so removing one
  member must not delete their recipes. A missing author shows as cook
  "Someone".
- `RecipeCategory` is the closed set `Starter | Main | Dessert | Other`
  (`src/shared/category.ts`), validated with Valibot.
- UI components in `src/ui/` must pass `.claude/rules/mobile.md` and reuse the
  shadcn primitives from `apps/web/src/components/ui` where a modal/menu is
  needed.
- The `.animate-oh-ring` utility (the timer-complete pulse) is defined in
  `apps/web/src/styles.css`, which also `@source`s this package so Tailwind
  emits its classes.
