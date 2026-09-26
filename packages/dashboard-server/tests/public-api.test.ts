import { describe, expect, it } from "vitest";

import * as constantsEntry from "../src/constants.ts";
import * as publicApi from "../src/index.ts";
// Type-only half of the public surface: importing these here means `tsc
// --noEmit` fails immediately if any is ever renamed or removed -- these
// have no runtime presence, so the Object.keys() snapshot below can't see
// them.
import type {
  DashboardServer,
  DashboardSource,
  ReporterStoreSeed,
  SelectedRunDashboardProjection,
} from "../src/index.ts";

/** Referenced only so the type-only imports above aren't dead code and every
 *  name is provably still resolvable by the type checker. Never constructed. */
export type PublicTypeSurface = [
  SelectedRunDashboardProjection,
  DashboardServer,
  DashboardSource,
  ReporterStoreSeed,
];

describe("public API surface", () => {
  it("exports the selected-run projection and server lifecycle", () => {
    expect(publicApi.projectSelectedRun).toBeTypeOf("function");
    expect(publicApi.startDashboardServer).toBeTypeOf("function");
    expect(publicApi.waitForDashboardShutdown).toBeTypeOf("function");
  });

  it("'./constants' matches the exact expected runtime export-name set", () => {
    expect(Object.keys(constantsEntry).toSorted()).toEqual([
      "DEFAULT_DASHBOARD_HOSTNAME",
      "DEFAULT_DASHBOARD_PORT",
      "WILDCARD_DASHBOARD_HOSTNAME",
    ]);
  });
});
