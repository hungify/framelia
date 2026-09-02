import type { BaselineSource } from "@framelia/contracts";
import { describe, expect, it } from "vitest";

import {
  baselineArtifacts,
  FIGMA_BASELINE_ARTIFACT,
  RUN_ARTIFACT,
  RUN_OUTPUTS,
  WEB_BASELINE_ARTIFACT,
} from "../src/artifacts.ts";

describe("RUN_ARTIFACT", () => {
  it("carries the expected fixed on-disk names", () => {
    expect(RUN_ARTIFACT).toEqual({
      actual: "actual.png",
      diff: "diff.png",
      score: "visual-score.json",
      runMeta: "run-meta.json",
      punchList: "punch-list.json",
      freshness: "last-verified.json",
    });
  });
});

describe("RUN_OUTPUTS", () => {
  it("lists exactly the artifacts the run pipeline produces and the done gate re-verifies", () => {
    expect(RUN_OUTPUTS).toEqual([
      RUN_ARTIFACT.actual,
      RUN_ARTIFACT.diff,
      RUN_ARTIFACT.score,
      RUN_ARTIFACT.runMeta,
      RUN_ARTIFACT.punchList,
    ]);
  });

  it("deliberately excludes the freshness receipt -- done-gate never requires it", () => {
    expect(RUN_OUTPUTS).not.toContain(RUN_ARTIFACT.freshness);
  });
});

describe("baselineArtifacts", () => {
  it("resolves the figma baseline artifact names for kind 'figma'", () => {
    expect(baselineArtifacts("figma")).toBe(FIGMA_BASELINE_ARTIFACT);
  });

  it("resolves the web baseline artifact names for any other kind", () => {
    // BaselineSource currently only schema-validates "figma"; the function's
    // own ternary defensively handles any other runtime value (a future
    // baseline kind, or data that bypassed schema validation) -- cast past
    // the current single-literal type to exercise that branch.
    expect(baselineArtifacts("page" as BaselineSource["kind"])).toBe(WEB_BASELINE_ARTIFACT);
  });
});
