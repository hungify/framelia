import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.ts";
// Type-only half of the public surface: importing these here means `tsc
// --noEmit` fails immediately if any is ever renamed or removed -- these
// have no runtime presence, so the Object.keys() snapshot below can't see
// them.
import type {
  DashboardProjection,
  DashboardServer,
  DashboardSource,
  ReporterStoreSeed,
} from "../src/index.ts";

/** Referenced only so the type-only imports above aren't dead code and every
 *  name is provably still resolvable by the type checker. Never constructed. */
export type PublicTypeSurface = [
  DashboardProjection,
  DashboardServer,
  DashboardSource,
  ReporterStoreSeed,
];

/**
 * Exact snapshot of every runtime-visible name re-exported from `src/index.ts`
 * (schemas, functions, classes, constants -- type-only exports have no
 * runtime presence and are separately guarded above via a compile-time
 * reference). If this test starts failing, an export was added, removed, or
 * renamed: that's a compatibility event for real consumers (`packages/cli`
 * and `packages/playwright` both import from this barrel), requiring a
 * changeset, not an incidental refactor.
 */
const EXPECTED_INDEX_EXPORTS = [
  "DEFAULT_DASHBOARD_PORT",
  "ReporterStore",
  "defaultClientRoot",
  "overallStatus",
  "projectArtifact",
  "startDashboardServer",
  "summarize",
  "waitForDashboardShutdown",
];

describe("public API surface", () => {
  it("'.' (src/index.ts) matches the exact expected runtime export-name set", () => {
    expect(Object.keys(publicApi).toSorted()).toEqual(EXPECTED_INDEX_EXPORTS);
  });
});
