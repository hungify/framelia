import {
  profileSchema,
  runTypeSchema,
  stabilitySchema,
  visualMaskSchema,
  webTargetSchema,
} from "@framelia/contracts";
import * as z from "zod";

import { MASK_COLOR } from "../capture/types.ts";

export const ExpectSizeSchema = z.strictObject({ width: z.number(), height: z.number() });
export const TopIssueSchema = z.looseObject({
  kind: z.string().optional(),
  severity: z.string().optional(),
  message: z.string().optional(),
});
const BaselineEvidenceSchema = z.strictObject({
  kind: z.literal("figma"),
  path: z.string(),
  metaPath: z.string(),
  fileKey: z.string(),
  nodeId: z.string(),
  fetchedAt: z.string(),
  lastModified: z.string().nullable(),
});

/** Strict shape of applied mask evidence; used at check time, not load time. */
export const MaskEvidenceSchema = z.strictObject({
  status: z.literal("applied"),
  maskColor: z.literal(MASK_COLOR),
  matchedCount: z.number().int().nonnegative(),
  unionMaskedArea: z.number().nonnegative(),
  maskedAreaRatio: z.number().nonnegative(),
  requested: z.array(
    z.strictObject({
      selector: z.string(),
      reason: z.string(),
      maxMatches: z.number().int().positive(),
      matchedCount: z.number().int().nonnegative(),
    }),
  ),
  bounds: z.array(
    z.strictObject({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
  ),
  resolvedAt: z.string(),
});
export type MaskEvidence = z.infer<typeof MaskEvidenceSchema>;

/**
 * Done-gate only inspects `maskEvidence`; the capture evidence payload is
 * loose so an incomplete/failed masked pass still surfaces its own gate reason
 * instead of a schema-load failure.
 */
export const CaptureEvidenceSchema = z.looseObject({
  maskEvidence: z.unknown().optional(),
});

export const ScoreFileSchema = z.looseObject({
  schemaVersion: z.number(),
  pass: z.boolean(),
  runType: runTypeSchema,
  capturedAt: z.string(),
  target: webTargetSchema,
  baseline: BaselineEvidenceSchema,
  viewport: z.string(),
  profile: profileSchema,
  pageReason: z.string().nullable(),
  selector: z.string().nullable(),
  expectSize: ExpectSizeSchema.nullable(),
  stability: stabilitySchema,
  outDir: z.string(),
  evidenceHashes: z.strictObject({
    baseline: z.string(),
    baselineMeta: z.string(),
    actual: z.string(),
    diff: z.string().nullable(),
  }),
  topIssues: z.array(TopIssueSchema).optional(),
  diagnostics: z
    .array(
      z.strictObject({
        kind: z.enum(["skipped", "unmatched-region", "font-fallback", "warning", "masked-pass"]),
        code: z.string(),
        message: z.string(),
        blocking: z.boolean(),
      }),
    )
    .optional(),
  captureEvidence: CaptureEvidenceSchema.optional(),
  baselineCaptureEvidence: CaptureEvidenceSchema.optional(),
});

export type ScoreFile = z.infer<typeof ScoreFileSchema>;

export const RunMetaSchema = z.looseObject({
  schemaVersion: z.number(),
  target: webTargetSchema,
  baseline: BaselineEvidenceSchema,
  viewport: z.string(),
  profile: z.string(),
  runType: z.string(),
  pageReason: z.string().nullable(),
  masks: z.array(visualMaskSchema).nullable().optional(),
  maxMaskedAreaRatio: z.number().nullable().optional(),
  captureEvidence: CaptureEvidenceSchema.optional(),
  baselineCaptureEvidence: CaptureEvidenceSchema.optional(),
  viewportSize: z.strictObject({ width: z.number().positive(), height: z.number().positive() }),
});

export type RunMeta = z.infer<typeof RunMetaSchema>;

export const PunchListSchema = z.looseObject({
  schemaVersion: z.number(),
  pass: z.boolean(),
  items: z.array(z.unknown()),
});

export function parseMaskEvidence(value: unknown): MaskEvidence | null {
  const result = MaskEvidenceSchema.safeParse(value);
  return result.success ? result.data : null;
}
