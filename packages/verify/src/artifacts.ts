import type { BaselineSource } from "@framelia/contracts";

/** Single source of truth for on-disk artifact names shared across run/gate/report. */
export const RUN_ARTIFACT = {
  actual: "actual.png",
  diff: "diff.png",
  score: "visual-score.json",
  runMeta: "run-meta.json",
  punchList: "punch-list.json",
  /** Opt-in receipt from contract-freshness.ts -- deliberately absent from RUN_OUTPUTS
   *  below, since done-gate never requires it. */
  freshness: "last-verified.json",
} as const;

export const FIGMA_BASELINE_ARTIFACT = {
  image: "figma-baseline.png",
  meta: "figma-baseline.meta.json",
} as const;

export const WEB_BASELINE_ARTIFACT = {
  image: "web-baseline.png",
  meta: "web-baseline.meta.json",
} as const;

/** Names produced by the run pipeline and re-verified by the done gate. */
export const RUN_OUTPUTS: readonly string[] = [
  RUN_ARTIFACT.actual,
  RUN_ARTIFACT.diff,
  RUN_ARTIFACT.score,
  RUN_ARTIFACT.runMeta,
  RUN_ARTIFACT.punchList,
];

export function baselineArtifacts(kind: BaselineSource["kind"]): {
  image: string;
  meta: string;
} {
  return kind === "figma" ? FIGMA_BASELINE_ARTIFACT : WEB_BASELINE_ARTIFACT;
}
