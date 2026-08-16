import * as fs from "node:fs";
import * as path from "node:path";

import { RUN_ARTIFACT } from "../artifacts.ts";
import { DEFAULT_MAX_BASELINE_AGE_MS, DEFAULT_MAX_SCORE_AGE_MS } from "../constants.ts";
import { resolveArtifactPath } from "../paths.ts";
import { SCHEMA_VERSION } from "../types.ts";
import { ScoreFileSchema, type ScoreFile } from "./schemas.ts";
import type {
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ViewportVerdict,
} from "./types.ts";
import { validateArtifacts, validateContract, validateScore, type Thresholds } from "./validate.ts";

export { DEFAULT_MAX_BASELINE_AGE_MS, DEFAULT_MAX_SCORE_AGE_MS };
export type {
  DoneGateOptions,
  DoneGateVerdict,
  DoneGateViewport,
  ViewportVerdict,
} from "./types.ts";

export function checkDoneGate(options: DoneGateOptions): DoneGateVerdict {
  const thresholds: Thresholds = {
    now: options.now?.() ?? Date.now(),
    maxScoreAgeMs: options.maxScoreAgeMs ?? DEFAULT_MAX_SCORE_AGE_MS,
    maxBaselineAgeMs: options.maxBaselineAgeMs ?? DEFAULT_MAX_BASELINE_AGE_MS,
  };
  const cwd = options.cwd ?? process.cwd();

  const viewports = options.viewports.map((contract): ViewportVerdict => {
    const reasons = validateContract(contract);
    const outDir = resolveArtifactPath(contract.outDir, cwd);
    const result = loadScore(outDir);
    if (!result.ok) {
      reasons.push(result.message);
      return verdict(contract.viewport, reasons);
    }
    reasons.push(...checkScore(result.score, contract, outDir, thresholds, cwd));
    return verdict(contract.viewport, reasons);
  });

  return { schemaVersion: SCHEMA_VERSION, done: viewports.every((item) => item.done), viewports };
}

function checkScore(
  score: ScoreFile,
  contract: DoneGateViewport,
  outDir: string,
  thresholds: Thresholds,
  cwd: string,
): string[] {
  return [
    ...validateScore(score, contract, thresholds),
    ...validateArtifacts(outDir, contract, score, cwd),
  ];
}

type LoadedScore = { ok: true; score: ScoreFile } | { ok: false; message: string };

/** Load and surface visual-score.json; failure is a reason string, not an exception. */
function loadScore(outDir: string): LoadedScore {
  const scorePath = path.join(outDir, RUN_ARTIFACT.score);
  if (!fs.existsSync(scorePath)) {
    return { ok: false, message: `missing ${RUN_ARTIFACT.score} at ${scorePath}.` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(scorePath, "utf8"));
  } catch {
    return { ok: false, message: `unreadable ${RUN_ARTIFACT.score} at ${scorePath}.` };
  }
  const parsed = ScoreFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      message: `${RUN_ARTIFACT.score} schema validation failed: ${parsed.error.message}`,
    };
  }
  return { ok: true, score: parsed.data };
}

function verdict(viewport: string, reasons: string[]): ViewportVerdict {
  return { viewport, done: reasons.length === 0, reasons };
}
