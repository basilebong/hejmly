# @hejmly/core

Platform plumbing. Two subpath exports:

- `./shared` — isomorphic helpers (branded IDs, Result). MUST run in the
  browser. NO server-only imports.
- `./server` — Better Auth, Drizzle db wiring, MCP transport plumbing,
  audit log, Hono middleware. Server only.

## Local rules
- App-specific code does NOT live here. Auth and audit are platform concerns;
  grocery state machines are not.
- Anything added under `src/shared/` must compile and run in the browser. No
  `bun:sqlite`, no Drizzle, no Hono, no `node:*`.
- ID factories live in `src/shared/ids.ts`. Use `Brand<string, "Name">`; never
  bare string for an ID.
- `Result<T, E>` is the only return type for services across module boundaries.
- Push notifications (`src/server/push/`) are platform plumbing like audit:
  - The VAPID key pair is generated on first use and stored in
    `push_vapid_keys`; there is no env var. Backing up the database backs it
    up; losing it invalidates every device subscription.
  - Subscription endpoints must pass `isAllowedPushEndpoint` (Google,
    Mozilla, Apple, Microsoft push hosts; https, port 443, no credentials).
    Never widen it to "any https URL": the server POSTs to that URL, so it
    would let any member make the server call internal hosts.
  - Sending: `fetchPushSender` never follows redirects and times out; logs
    carry only the endpoint's origin, never the full URL (it is a bearer
    capability for that device). 404/410 delete the device.
  - `notify` targets only members (`isMember`, i.e. the allowlist), never the
    actor, and honours per-person topic preferences (default on). Apps call
    `notify`; they never read subscriptions themselves.
  - `PushMessage.url` must be a same-origin path; `tag` doubles as the RFC
    8030 `Topic`, so it is limited to `[A-Za-z0-9_-]{1,32}`.

