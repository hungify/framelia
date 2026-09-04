/**
 * Lightweight constants needed by `commands/*.ts` flag declarations at route-map-build
 * time. This module is imported statically by every command declaration file, so it must
 * never import `@framelia/verify`, `@clack/prompts`, `@framelia/dashboard-server`, or
 * Playwright -- doing so would defeat the lazy-loading contract (see the rewrite plan's
 * "Startup: lazy-load every command" section) by pulling heavy runtime code into every
 * command's static import graph, including `status`.
 */

// Exit codes -- mirrors @framelia/verify's constants.ts values (0/1/2) without importing
// the heavy verify root from every command declaration file.
export const EXIT_OK = 0;
export const EXIT_VISUAL_FAIL = 1;
export const EXIT_USAGE_ERROR = 2;

export const JSON_INDENT_SPACES = 2;

// Mirrors @framelia/dashboard-server's DEFAULT_DASHBOARD_PORT (6789). Duplicated as a
// plain literal rather than imported, because @framelia/dashboard-server has no
// lightweight subpath export and its root entry imports @hono/node-server.
export const DEFAULT_DASHBOARD_PORT = 6789;

export const VIEWPORT_PRESETS = ["desktop", "mobile", "custom"] as const;
export type ViewportPreset = (typeof VIEWPORT_PRESETS)[number];

export const SCOPE_KINDS = ["page", "region"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/**
 * Stricli's `kind: "parsed"` flags require a `parse` function even for plain strings
 * (there is no built-in string-passthrough parser, unlike its `numberParser`/`booleanParser`).
 */
export function identityParser(input: string): string {
  return input;
}

export const projectRootFlag = {
  kind: "parsed",
  parse: identityParser,
  optional: true,
  brief: "target project root",
  placeholder: "dir",
} as const;
