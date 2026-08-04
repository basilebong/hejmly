# Lint, formatting, and commit rules

## No suppression. Ever.

Per CLAUDE.md rule 14. None of these are allowed anywhere in the repo:

- `// biome-ignore <...>`
- `// eslint-disable*`, `/* eslint-disable */`
- `// @ts-ignore`, `// @ts-expect-error`, `// @ts-nocheck`
- File-level disable comments at the top of any source file
- Per-path exception lists inside `biome.json`, `scripts/check-source.ts`,
  or anywhere else
- Renaming a forbidden API (`as`, `!`, etc.) to a wrapper just to launder
  the violation

If a rule is blocking, the fix is in the code: change the signature, parse
the value, add a type guard, restructure the logic. If the rule itself is
genuinely wrong, remove it from `biome.json` or `scripts/check-source.ts`
in a separate PR with a written justification — global, not per-line.

`check-source.ts` ships NO suppression mechanism on purpose. Don't add one.

## What runs

`pnpm check` (Biome) and `pnpm check:source` (TypeScript AST) both gate CI
and the `pre-commit` hook. `tsc -b` also runs at pre-commit.

## Biome

- Formatter: 2-space, double quotes, semicolons, trailing commas. Line width
  100. Defined in `biome.json`.
- Import ordering: `assist.actions.source.organizeImports = "on"`. Imports AND
  export specifiers are sorted on save / on `pnpm lint:fix`. Manual re-ordering
  is wasted effort.
- `noExplicitAny: error`, `noNonNullAssertion: error`, `useImportType: error`,
  `useExportType: error`, `noUnusedImports: error`, `noUnusedVariables: error`.
- `useSortedClasses` (Tailwind class ordering) recognises `cn`, `clsx`, `cva`,
  `tw`.
- `css.parser.tailwindDirectives = true`. Biome 2 lints CSS by default and
  rejects `@source` / `@theme` / `@utility` / `@custom-variant` without this.
- `apps/web/public` is outside `files.includes`. It holds only static assets,
  and Biome 2 lints `.svg`, which flags the favicon for `noSvgWithoutTitle` —
  a rule meant for inline JSX SVG, not asset files.

### Why `noArrayIndexKey` is `warn`, not `error`

It is a good rule and stays on and visible; Biome exits 0 on warnings, so it
does not gate CI. The two sites that trip it are the step lists in
`RecipeDetailScreen`. Their entire subtree — `StepCard`, `TimeChip`,
`StepIngredients` — is stateless, and timers are keyed by the domain's own
`timer.id` through an externally-held `TimerMap`, so an index-derived key
cannot mis-associate component state there. The cost is reconciliation
efficiency on a read-only list that re-fetches wholesale, not correctness.

`RecipeStep` has no persisted identity to key on (`{title, body, concurrent,
uses, timers}`), and giving it one changes the recipes HTTP response and the
MCP tool output shape — a MAJOR tool bump per `.claude/rules/tools.md`. That is
a product decision, not a lint fix. Raise this rule to `error` once `RecipeStep`
gains a real id.

## AST checks (`pnpm check:source`)

Implemented in `scripts/check-source.ts` (Bun + TypeScript compiler API).
One rule:

### `no-bare-as`

Forbids `expr as Type` and `<Type>expr` casts. The only allowed form is
`expr as const`.

Wrong:
```ts
const u = JSON.parse(raw) as User;
const x = <string>value;
```

Right:
```ts
const parsed = userSchema.parse(raw);
const x = isString(value) ? value : "";
const tuple = [1, 2, 3] as const;
```

Narrow with type guards, ts-pattern, or schema validation (Valibot / Zod).
If you genuinely need an assertion (FFI-style boundary), wrap it in a
single named parser/guard so the cast is in one place.

### Export sorting — owned by Biome, not `check:source`

`check-source.ts` used to ship a second rule, `sorted-exports`, enforcing
alphabetical order inside `export { a, b, c }` blocks. It was removed when we
moved to Biome 2.

Biome 2's `assist/source/organizeImports` sorts export specifiers *and* export
statements, and it is an error in `pnpm check`, so the coverage is strictly
larger than the old rule. Keeping both was actively harmful: they disagreed on
case ordering — Biome sorts uppercase first (`Auth, CreateAuthOptions,
createAuth`), the old rule used `localeCompare` (`Auth, createAuth,
CreateAuthOptions`) — so `pnpm lint:fix` and `pnpm check:source` would undo each
other forever.

Biome is the single authority on ordering. `check:source` now enforces one rule
only: `no-bare-as`.

## Setup

Hooks are managed by [lefthook](https://github.com/evilmartians/lefthook)
(config in `lefthook.yml`). Install with:

```bash
pnpm hooks:install   # one-time: writes .git/hooks/* via `lefthook install`
```

`pnpm install` does NOT install hooks automatically — `.npmrc` has
`ignore-scripts=true` (rule 2 / §8.2). The explicit step is intentional.
