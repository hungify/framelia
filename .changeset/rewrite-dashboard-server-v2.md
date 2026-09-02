---
"@framelia/dashboard-server": patch
---

Rewrite `@framelia/dashboard-server` (v2 rewrite plan, Package 3): extracts
`server.ts`'s port-retry loop and shutdown-signal handling into their own,
independently-tested modules, adopts `@hono/node-server`'s `serveStatic`
for the client/SPA route, and fixes a downstream breakage from the
`contracts`/`verify` rename.

**Fix (dependency bump, not a new breaking change):**

- `src/model.ts` imported the pre-rewrite `ContractDefaults` name from
  `@framelia/verify`. Both `@framelia/contracts` and `@framelia/verify`
  already renamed this to `CaptureDefaults` in their own v2 rewrites; this
  package's `typecheck` was broken until this fix landed. Purely a
  downstream consequence of an already-breaking change made upstream, not
  a new breaking change originating in this package.

**Accepted behavior change (patch, not breaking -- no name, signature, or
status-code change; documented and tested):**

- `/artifacts/*.json` responses lose the `; charset=utf-8` suffix on their
  `content-type` header (now bare `application/json`). The artifact
  route's content-type lookup now uses Hono's own `getMimeType` (a
  49-extension table) instead of a hand-rolled 6-entry map, and Hono's
  table omits the charset suffix for `.json` specifically (unlike `.css`/
  `.html`/`.js`, which do carry one). Both real consumers -- the dashboard
  client and `@framelia/playwright`'s Reporter -- parse this body via
  `.json()`/`JSON.parse`, which is charset-agnostic for UTF-8, so this is
  a behavior change with no known real-world impact. Documented and
  pinned with an explicit test in `tests/static-assets.test.ts`.

**Non-breaking:**

- `waitForDashboardShutdown` moves into a new `src/shutdown.ts`, now
  taking an injectable `ShutdownSignalSource` (`{ once, off }`) that
  defaults to the real `process` in production. The exported name and
  zero-arg call signature real consumers use are unchanged.
- The `EADDRINUSE` port-retry loop moves into a new `src/port-listener.ts`
  (`listenWithPortRetry`), parameterized instead of closed over `app`/
  `options`, with an injectable `onPortInUse` diagnostic callback.
- The client/SPA route now uses `@hono/node-server`'s `serveStatic`
  instead of a hand-rolled `sendFile`/`contained` pair: real path-
  traversal rejection, a 49-extension MIME table (vs. the previous 6
  entries), and the standard two-middleware SPA-fallback pattern. Zero new
  dependency -- `serve-static` ships as a subpath of the existing
  `@hono/node-server` dependency. The `/artifacts/*` route stays
  hand-rolled (it resolves a virtual path through an application-defined
  async allowlist `Map` built from scattered real output directories,
  which doesn't fit `serveStatic`'s synchronous single-root config).
- `server.ts` is now pure route wiring; `src/static-assets.ts` owns the
  client and artifact routes.
- New tests close two previously-zero-coverage areas (confirmed via grep
  before this rewrite: no `EADDRINUSE`/`SIGINT`/`SIGTERM` anywhere in
  `tests/`): `tests/shutdown.test.ts` (fake signal source, never sends a
  real OS signal), `tests/port-listener.test.ts` (real sockets bound in
  `beforeEach`/closed in `afterEach` -- a genuine OS-level condition isn't
  worth faking), and `tests/static-assets.test.ts`. `tests/server.test.ts`
  adds one true end-to-end `EADDRINUSE` test through the full
  `startDashboardServer` public API, plus `tests/public-api.test.ts`
  snapshotting `src/index.ts`'s exact runtime export-name set.
- Three fatal `throw new Error(string)` sites relocate along with their
  code (client-build-missing into `static-assets.ts`, address-resolution
  into `server.ts`) but stay plain `Error`, not `@framelia/verify`'s
  `AppError`: verify's `AppErrorCode` union is a closed set specific to
  verify's own path/env-file/hex-color/dimension-mismatch failure classes
  (`MISSING_PROJECT_ROOT`, `INVALID_PROJECT_RELATIVE_PATH`,
  `PATH_ESCAPES_PROJECT_ROOT`, `ENV_FILE_ENTRY_INVALID`,
  `ENV_FILE_NOT_FOUND`, `INVALID_HEX_COLOR`, `DIMENSION_MISMATCH`) -- none
  of which match this package's port/listen/shutdown/client-build
  concerns.
