import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { baselineArtifacts, RUN_ARTIFACT, RUN_OUTPUTS } from "../artifacts.ts";
import { CLOCK_SKEW_MS, FIGMA_NODE_ID, MS_PER_HOUR, MS_PER_MINUTE } from "../constants.ts";
import { resolveArtifactPath } from "../paths.ts";
import { SCHEMA_VERSION } from "../types.ts";
import {
  completeMaskEvidence,
  isUrl,
  sameBaseline,
  sameMasks,
  sameProfileOverrides,
  sameSize,
  sameTarget,
} from "./contract-predicates.ts";
import { PunchListSchema, RunMetaSchema, type RunMeta, type ScoreFile } from "./schemas.ts";
import type { DoneGateViewport } from "./types.ts";

export function validateContract(contract: DoneGateViewport): string[] {
  const reasons: string[] = [];
  if (contract.target.kind !== "web" || !isUrl(contract.target.url))
    reasons.push("valid web target required.");
  if (!contract.baseline.fileKey) reasons.push("Figma baseline fileKey required.");
  if (!FIGMA_NODE_ID.test(contract.baseline.nodeId)) reasons.push("Figma baseline nodeId invalid.");
  if (contract.profile === "component/dev")
    reasons.push("done gate forbids component/dev; use component/strict for final contract.");
  if (contract.profile === "page") {
    if (!contract.pageReason?.trim()) reasons.push("page contract requires pageReason.");
    if (contract.selector) reasons.push("page contract must not set selector.");
    if (contract.expectSize) reasons.push("page contract must not set expectSize.");
  } else {
    if (!contract.selector) reasons.push("component contract requires selector.");
    if (contract.profile === "component/strict" && !contract.expectSize)
      reasons.push("component/strict contract requires expectSize.");
  }
  return reasons;
}

export interface Thresholds {
  now: number;
  maxScoreAgeMs: number;
  maxBaselineAgeMs: number;
}

export function validateScore(
  score: ScoreFile,
  contract: DoneGateViewport,
  thresholds: Thresholds,
): string[] {
  return [...validateIdentity(score, contract), ...validateTimeStamps(score, thresholds)];
}

function validateIdentity(score: ScoreFile, contract: DoneGateViewport): string[] {
  const reasons: string[] = [];
  if (score.schemaVersion !== SCHEMA_VERSION)
    reasons.push(`score schemaVersion must be ${SCHEMA_VERSION}.`);
  if (score.pass !== true) reasons.push("pass is not true.");
  if (score.runType !== "final") reasons.push('runType must be "final".');
  if (!sameTarget(score.target, contract.target)) reasons.push("target does not match contract.");
  if (!sameBaseline(score.baseline, contract.baseline))
    reasons.push("baseline does not match contract.");
  if (score.viewport !== contract.viewport) reasons.push("viewport does not match contract.");
  if (score.profile !== contract.profile) reasons.push("profile does not match contract.");
  if (!sameProfileOverrides(contract.profile, score.profileOverrides, contract.profileOverrides))
    reasons.push("profileOverrides do not match contract.");
  if (score.profile === "page" && !score.pageReason?.trim())
    reasons.push("page score missing pageReason.");
  if (score.profile === "page" && score.pageReason !== contract.pageReason)
    reasons.push("pageReason does not match contract.");
  if ((score.selector ?? undefined) !== contract.selector)
    reasons.push("selector does not match contract.");
  if (!sameSize(score.expectSize, contract.expectSize))
    reasons.push("expectSize does not match contract.");
  if (score.stability !== "stable") reasons.push('stability must be "stable".');
  if (
    score.topIssues?.some(
      (issue) =>
        issue.kind === "residual" && (issue.severity === "medium" || issue.severity === "high"),
    )
  ) {
    reasons.push("blocking residual diff cluster remains.");
  }
  for (const diagnostic of score.diagnostics ?? []) {
    if (diagnostic.blocking)
      reasons.push(`blocking evidence diagnostic: ${diagnostic.code}: ${diagnostic.message}`);
  }
  return reasons;
}

function validateTimeStamps(score: ScoreFile, thresholds: Thresholds): string[] {
  const reasons: string[] = [];
  validateAge(
    score.capturedAt,
    "capturedAt",
    thresholds.now,
    thresholds.maxScoreAgeMs,
    MS_PER_MINUTE,
    "min",
    reasons,
  );
  const baselineTime = score.baseline.fetchedAt;
  validateAge(
    baselineTime,
    "baseline timestamp",
    thresholds.now,
    thresholds.maxBaselineAgeMs,
    MS_PER_HOUR,
    "h",
    reasons,
  );
  const capturedAtMs = Date.parse(score.capturedAt);
  const baselineAtMs = Date.parse(baselineTime);
  if (
    Number.isFinite(capturedAtMs) &&
    Number.isFinite(baselineAtMs) &&
    baselineAtMs > capturedAtMs + CLOCK_SKEW_MS
  ) {
    reasons.push("baseline timestamp is later than target capture.");
  }
  return reasons;
}

function validateAge(
  value: string,
  label: string,
  now: number,
  maxAgeMs: number,
  unitMs: number,
  unit: string,
  reasons: string[],
): void {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) reasons.push(`${label} missing/unparseable.`);
  else if (timestamp > now + CLOCK_SKEW_MS) reasons.push(`${label} is in future.`);
  else if (now - timestamp > maxAgeMs)
    reasons.push(`${label} older than ${Math.round(maxAgeMs / unitMs)}${unit}.`);
}

export function validateArtifacts(
  outDir: string,
  contract: DoneGateViewport,
  score: ScoreFile,
  cwd: string,
): string[] {
  const names = baselineArtifacts(contract.baseline.kind);
  const expectedBaseline = path.join(outDir, names.image);
  const expectedMeta = path.join(outDir, names.meta);
  return [
    ...validateMaskEvidence(contract, score),
    ...(score.baseline.path !== expectedBaseline || score.baseline.metaPath !== expectedMeta
      ? ["baseline evidence paths do not match contract directory."]
      : []),
    ...requiredFileReasons(outDir, names),
    ...runMetaReasons(outDir, contract),
    ...punchListReasons(outDir, score),
    ...baselineMetaReasons(expectedMeta, contract, score),
    ...evidenceHashReasons(outDir, names, score),
    ...(score.outDir && resolveArtifactPath(score.outDir, cwd) !== outDir
      ? ["score outDir does not match declared artifact directory."]
      : []),
  ];
}

export function validateMaskEvidence(contract: DoneGateViewport, score: ScoreFile): string[] {
  if (!contract.masks?.length) return [];
  const evidence = score.captureEvidence?.maskEvidence;
  return !completeMaskEvidence(evidence, contract.masks)
    ? ["complete mask evidence required for masked pass."]
    : [];
}

function requiredFileReasons(outDir: string, names: { image: string; meta: string }): string[] {
  return [...RUN_OUTPUTS, names.image, names.meta]
    .filter((name) => !fs.existsSync(path.join(outDir, name)))
    .map((name) => `missing ${name}.`);
}

function runMetaReasons(outDir: string, contract: DoneGateViewport): string[] {
  try {
    const parsed = RunMetaSchema.safeParse(
      JSON.parse(fs.readFileSync(path.join(outDir, RUN_ARTIFACT.runMeta), "utf8")),
    );
    if (!parsed.success) return [`${RUN_ARTIFACT.runMeta} schema validation failed.`];
    const meta = parsed.data;
    const reasons: string[] = [];
    if (meta.schemaVersion !== SCHEMA_VERSION) reasons.push("run-meta schemaVersion mismatch.");
    if (!sameTarget(meta.target, contract.target)) reasons.push("run-meta target mismatch.");
    if (!sameBaseline(meta.baseline, contract.baseline))
      reasons.push("run-meta baseline mismatch.");
    if (meta.viewport !== contract.viewport || meta.profile !== contract.profile)
      reasons.push("run-meta viewport/profile mismatch.");
    if (!sameProfileOverrides(contract.profile, meta.profileOverrides, contract.profileOverrides))
      reasons.push("run-meta profileOverrides do not match contract.");
    if (meta.runType !== "final") reasons.push("run-meta runType must be final.");
    if (contract.profile === "page" && meta.pageReason !== contract.pageReason)
      reasons.push("run-meta pageReason mismatch.");
    if (!sameMasks(meta.masks, contract.masks))
      reasons.push("run-meta masks do not match contract.");
    if ((meta.maxMaskedAreaRatio ?? undefined) !== contract.maxMaskedAreaRatio)
      reasons.push("run-meta maxMaskedAreaRatio does not match contract.");
    if (contract.masks?.length && !metaMaskEvidenceComplete(meta, contract))
      reasons.push("run-meta missing complete mask evidence.");
    if (!meta.viewportSize || typeof meta.viewportSize !== "object")
      reasons.push(`${RUN_ARTIFACT.runMeta} viewportSize missing.`);
    return reasons;
  } catch {
    return [`${RUN_ARTIFACT.runMeta} unreadable or invalid.`];
  }
}

function metaMaskEvidenceComplete(meta: RunMeta, contract: DoneGateViewport): boolean {
  const capture = meta.captureEvidence?.maskEvidence;
  return completeMaskEvidence(capture, contract.masks!);
}

function punchListReasons(outDir: string, score: ScoreFile): string[] {
  try {
    const parsed = PunchListSchema.safeParse(
      JSON.parse(fs.readFileSync(path.join(outDir, RUN_ARTIFACT.punchList), "utf8")),
    );
    if (!parsed.success) return [`${RUN_ARTIFACT.punchList} schema validation failed.`];
    return [
      ...(parsed.data.schemaVersion !== SCHEMA_VERSION
        ? [`${RUN_ARTIFACT.punchList} schemaVersion mismatch.`]
        : []),
      ...(parsed.data.pass !== score.pass
        ? [`${RUN_ARTIFACT.punchList} pass does not match score.`]
        : []),
    ];
  } catch {
    return [`${RUN_ARTIFACT.punchList} unreadable or invalid.`];
  }
}

function baselineMetaReasons(
  metaPath: string,
  contract: DoneGateViewport,
  score: ScoreFile,
): string[] {
  if (!fs.existsSync(metaPath)) return [];
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    return [
      ...(meta.fileKey !== contract.baseline.fileKey || meta.nodeId !== contract.baseline.nodeId
        ? ["Figma baseline metadata identity mismatch."]
        : []),
      ...(meta.fetchedAt !== score.baseline.fetchedAt
        ? ["Figma baseline timestamp evidence mismatch."]
        : []),
    ];
  } catch {
    return ["baseline metadata unreadable."];
  }
}

function evidenceHashReasons(
  outDir: string,
  names: { image: string; meta: string },
  score: ScoreFile,
): string[] {
  const files = {
    baseline: names.image,
    baselineMeta: names.meta,
    actual: RUN_ARTIFACT.actual,
    diff: RUN_ARTIFACT.diff,
  } as const;
  const reasons: string[] = [];
  for (const key of Object.keys(files) as Array<keyof typeof files>) {
    const name = files[key];
    const filePath = path.join(outDir, name);
    if (!fs.existsSync(filePath)) continue;
    const actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
    if (!score.evidenceHashes[key] || score.evidenceHashes[key] !== actual)
      reasons.push(`${name} hash does not match score.`);
  }
  return reasons;
}
