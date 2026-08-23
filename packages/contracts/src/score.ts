import * as z from "zod";

import { SCHEMA_VERSION } from "./constants.ts";
import { profileSchema } from "./contract.ts";
import { httpUrlSchema } from "./primitives.ts";

const scoreSizeSchema = z
  .object({
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
  })
  .strict();

const scoreHashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const stabilitySchema = z.enum(["stable", "borderline", "unknown"]);
export type Stability = z.infer<typeof stabilitySchema>;

export const captureMaskEvidenceSchema = z
  .object({
    requested: z.array(
      z
        .object({
          selector: z.string().min(1),
          reason: z.string().min(1),
          maxMatches: z.number(),
          matchedCount: z.number().optional(),
        })
        .loose(),
    ),
    matchedCount: z.number(),
    bounds: z.array(
      z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).loose(),
    ),
    unionMaskedArea: z.number(),
    maskedAreaRatio: z.number(),
    maskColor: z.string(),
    status: z.enum(["applied", "skipped", "failed"]),
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .loose();

/**
 * Evidence payload capture writes into visual-score.json/run-meta.json.
 * Kept permissive (loose, per-field .catch()) so an evidence shape
 * drift degrades to "no evidence shown" instead of rejecting the whole
 * score file — the rest of the artifact is still trustworthy on its own.
 */
export const captureEvidenceSchema = z
  .object({
    finalUrl: z.string(),
    startedAt: z.string(),
    finishedAt: z.string(),
    capturedAt: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }).loose().nullable(),
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("page"), fullPage: z.boolean().optional() }).loose(),
      z
        .object({
          kind: z.literal("region"),
          selector: z.string(),
          expectedSize: z.object({ width: z.number(), height: z.number() }).optional(),
        })
        .loose(),
    ]),
    elementRect: z.object({ width: z.number(), height: z.number() }).loose().nullable(),
    readiness: z
      .object({
        selector: z.string().optional(),
        event: z.string().optional(),
        matchCount: z.number().optional(),
        status: z.enum(["passed", "failed"]),
      })
      .loose()
      .nullable(),
    fonts: z
      .object({
        supported: z.boolean(),
        status: z.enum(["loaded", "loading", "unknown"]),
        failed: z.array(z.string()),
      })
      .loose(),
    screenshotHashes: z.array(z.string()),
    warnings: z.array(z.string()),
    actions: z.array(
      z
        .object({
          index: z.number(),
          kind: z.string(),
          status: z.enum(["passed", "failed"]),
          attempts: z.number(),
          startedAt: z.string(),
          finishedAt: z.string(),
          selector: z.string().optional(),
          error: z.string().optional(),
        })
        .loose(),
    ),
    maskEvidence: captureMaskEvidenceSchema.nullable().optional().catch(null),
  })
  .loose();

export const visualDiagnosticSchema = z
  .object({
    kind: z.enum(["skipped", "unmatched-region", "font-fallback", "warning", "masked-pass"]),
    code: z.string().min(1),
    message: z.string().min(1),
    blocking: z.boolean(),
  })
  .strict();

/** Mirrors @framelia/verify's TopIssue -- contracts can't import it (verify depends on
 * contracts, not the reverse), so this schema restates the same shape independently. */
export const topIssueSchema = z
  .object({
    severity: z.enum(["high", "medium", "low"]),
    kind: z.enum([
      "size",
      "expect-size",
      "pixel",
      "ssim",
      "color",
      "cluster",
      "style-typography",
      "style-color",
      "style-check-error",
      "baseline-stability",
      "capture-stability",
      "residual",
    ]),
    message: z.string().min(1),
    hint: z.string().optional(),
    repairCandidate: z.boolean(),
    blocking: z.boolean(),
    /** Which page-scope check-point selector this issue came from; absent for
     *  region-scope and non-style issues. */
    selector: z.string().optional(),
  })
  .strict();

export const visualScoreArtifactSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    ok: z.literal(true),
    pass: z.boolean(),
    matchRatio: z.number().min(0).max(1).nullable(),
    ssim: z.number().min(0).max(1).nullable(),
    avgDeltaE: z.number().nonnegative().nullable(),
    diffPixels: z.number().int().nonnegative().nullable(),
    baselineSize: scoreSizeSchema,
    actualSize: scoreSizeSchema,
    baseline: z
      .object({
        kind: z.enum(["figma", "web"]),
        path: z.string().min(1),
        fileKey: z.string().optional(),
        nodeId: z.string().optional(),
        fetchedAt: z.iso.datetime().optional(),
        url: httpUrlSchema.optional(),
        revision: z.string().min(1).optional(),
      })
      .loose(),
    target: z.object({ url: httpUrlSchema }).loose(),
    selector: z.string().nullable(),
    stability: stabilitySchema,
    evidenceHashes: z
      .object({
        baseline: scoreHashSchema,
        actual: scoreHashSchema,
        diff: scoreHashSchema.nullable(),
      })
      .loose(),
    artifacts: z
      .object({
        baseline: z.string().min(1),
        actual: z.string().min(1),
        diff: z.string().min(1).nullable(),
      })
      .loose(),
    diagnostics: z.array(visualDiagnosticSchema).optional(),
    topIssues: z.array(topIssueSchema).optional(),
    captureEvidence: captureEvidenceSchema.optional().catch(undefined),
    baselineCaptureEvidence: captureEvidenceSchema.optional().catch(undefined),
    /** The profile/clusterCheck the comparison actually resolved to and ran with (see #4's
     * resolveFigmaCompareOptions) -- dashboard-server's model.ts reads these back to derive
     * DashboardContractResult["resolvedThreshold"] without re-deriving the resolution logic. */
    profile: profileSchema.optional().catch(undefined),
    clusterCheck: z.boolean().optional().catch(undefined),
    /** Explicit styleGateEligible override the matcher call was given, if any -- read back by
     *  dashboard-server's model.ts to resolve DashboardContractResult["styleGateEligible"]. */
    styleGateEligible: z.boolean().optional().catch(undefined),
  })
  .loose();

export type VisualScoreArtifact = z.infer<typeof visualScoreArtifactSchema>;
export type CaptureEvidenceArtifact = z.infer<typeof captureEvidenceSchema>;
export type VisualDiagnostic = z.infer<typeof visualDiagnosticSchema>;
export type VisualTopIssue = z.infer<typeof topIssueSchema>;
