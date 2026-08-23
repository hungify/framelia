import * as z from "zod";

import { baselineSchema } from "./baseline.ts";
import { CONTRACT_ID_PATTERN, FIGMA_NODE_ID, MAX_MASK_SELECTORS } from "./constants.ts";
import { VISUAL_ARTIFACT_DIR_PATTERN, visualArtifactPath } from "./paths.ts";
import { nonEmptyTrimmed } from "./primitives.ts";

export const profileSchema = z.enum(["page", "component/strict", "component/dev"]);
export type ProfileName = z.infer<typeof profileSchema>;

export const componentProfileSchema = profileSchema.exclude(["page"]);

export const runTypeSchema = z.enum(["dev", "final"]);
export type RunType = z.infer<typeof runTypeSchema>;

export const viewportSchema = z
  .object({
    name: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const expectSizeSchema = z
  .object({
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();

/**
 * Expected computed text style, baked into the contract from a live Figma node lookup
 * at `framelia contract create` time. Verify compares captured DOM style against this
 * offline.
 */
export const expectStyleSchema = z
  .object({
    fontWeight: z.number().optional(),
    fontSizePx: z.number().positive().optional(),
    lineHeightPx: z.number().positive().optional(),
    letterSpacingPx: z.number().optional(),
    color: z
      .object({
        r: z.number().min(0).max(255),
        g: z.number().min(0).max(255),
        b: z.number().min(0).max(255),
        a: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    /** Which captured DOM style property `color` should be checked against; TEXT figma nodes use "color", everything else "backgroundColor". */
    colorProperty: z.enum(["color", "backgroundColor"]).optional(),
  })
  .strict();

/**
 * One page-scope style check-point: an element inside the page identified by a CSS
 * selector, verified against its own Figma node (necessarily distinct from the page
 * contract's own baseline node) -- see #27's per-checkpoint style comparison.
 * `expectStyle` is best-effort baked in from that node at `framelia contract create`
 * time, the same way region scope's single selector already bakes its own.
 */
export const styleCheckPointSchema = z
  .object({
    selector: nonEmptyTrimmed,
    nodeId: z.string().regex(FIGMA_NODE_ID),
    expectStyle: expectStyleSchema.optional(),
  })
  .strict();

export const pageScopeSchema = z
  .object({
    kind: z.literal("page"),
    pageReason: nonEmptyTrimmed,
    styleChecks: z.array(styleCheckPointSchema).min(1).optional(),
  })
  .strict();

export const regionScopeSchema = z
  .object({
    kind: z.literal("region"),
    selector: nonEmptyTrimmed,
    expectSize: expectSizeSchema.optional(),
    expectStyle: expectStyleSchema.optional(),
  })
  .strict();

export const contractScopeSchema = z.discriminatedUnion("kind", [
  pageScopeSchema,
  regionScopeSchema,
]);

// Rejects selectors broad enough to mask the whole app instead of one dynamic element:
// document/body, common root/app-shell ids, and framelia/app/shell-flavored data-testid or classes.
// "app"/"shell" must appear as a whole hyphen-delimited word (\b), not a substring — otherwise
// ordinary selectors like ".approval-count" or ".appointment-badge" get rejected as false positives.
const BROAD_MASK_SELECTOR =
  /^(?:html|body|#root|#app|\[data-(?:testid|framelia)[^\]]*\b(?:app|shell)\b[^\]]*\]|\.[\w-]*\b(?:app|shell)\b[\w-]*)(?:\s|>|$)/i;

/**
 * Practically-overridable subset of verify's Profile: the fields consumed directly by
 * compare()'s pass/fail computation and its early-exit size-gap check. `cluster` is
 * deliberately excluded -- it's already a dedicated `clusterCheck` field on this same
 * contract (see resolveFigmaCompareOptions), and `stabilityMaxDiffRatio` is excluded
 * because nothing in the compare pipeline currently reads it.
 */
export const profileOverridesSchema = z
  .object({
    minMatch: z.number().min(0).max(1).optional(),
    maxDiffPixels: z.number().int().nonnegative().nullable().optional(),
    minSSIM: z.number().min(0).max(1).optional(),
    maxAvgDeltaE: z.number().nonnegative().optional(),
    maxAreaGapPercent: z.number().nonnegative().optional(),
  })
  .strict();

/**
 * Practically-overridable tolerances compareStyles() applies when diffing a region
 * contract's captured DOM style against its Figma-side StyleSnapshot -- mirrors
 * profileOverridesSchema's pattern (git-committed, PR-reviewed, no dashboard UI).
 * Style mismatches stay informational-only (TopIssue.blocking: false) regardless
 * of this override -- see style-compare.ts.
 */
export const styleToleranceOverridesSchema = z
  .object({
    /** Perceptual (CIEDE2000) distance a color/backgroundColor pair may differ by before flagging. */
    maxColorDeltaE: z.number().nonnegative().optional(),
    /** Pixel epsilon a spacing side may differ by before flagging. */
    maxSpacingDeltaPx: z.number().nonnegative().optional(),
    /** Pixel epsilon fontSize may differ by before flagging. */
    maxFontSizeDeltaPx: z.number().nonnegative().optional(),
    /** Pixel epsilon lineHeightPx may differ by before flagging. */
    maxLineHeightDeltaPx: z.number().nonnegative().optional(),
    /** Pixel epsilon letterSpacingPx may differ by before flagging. */
    maxLetterSpacingDeltaPx: z.number().nonnegative().optional(),
  })
  .strict();

export const visualMaskSchema = z
  .object({
    selector: nonEmptyTrimmed.refine((selector) => !BROAD_MASK_SELECTOR.test(selector.trim()), {
      message: "mask selector cannot target document, root, or app shell",
    }),
    reason: nonEmptyTrimmed,
    maxMatches: z.number().int().positive().max(MAX_MASK_SELECTORS).optional(),
  })
  .strict();

export const verificationContractSchema = z
  .object({
    id: z.string().regex(CONTRACT_ID_PATTERN),
    baseline: baselineSchema,
    viewport: viewportSchema,
    // Defaults to `visualArtifactPath(id)` when omitted — see the transform below.
    outDir: z.string().regex(VISUAL_ARTIFACT_DIR_PATTERN).optional(),
    scope: contractScopeSchema,
    profile: componentProfileSchema.optional(),
    /** Resolved clusterCheck override compare() ran with -- see resolveFigmaCompareOptions. */
    clusterCheck: z.boolean().optional(),
    /** Explicit per-contract threshold overrides, merged on top of the resolved profile's own defaults. */
    profileOverrides: profileOverridesSchema.optional(),
    /** Explicit per-contract style-comparison tolerance overrides, merged on top of compareStyles()'s own defaults. */
    styleToleranceOverrides: styleToleranceOverridesSchema.optional(),
    /** Explicit override of whether this contract's resolved threshold blocks the CI merge
     *  gate; unset falls back to the resolved profile's own gateEligible default. Lets a
     *  deliberately loose custom threshold opt out of gating without naming a "dev" preset,
     *  and lets an explicitly-loose preset opt back in -- see done-gate/validate.ts. */
    gateEligible: z.boolean().optional(),
    masks: z.array(visualMaskSchema).min(1).max(MAX_MASK_SELECTORS).optional(),
  })
  .strict()
  .superRefine((contract, context) => {
    if (contract.scope.kind === "page" && contract.profile != null) {
      context.addIssue({
        code: "custom",
        path: ["profile"],
        message: "page contract must not set component profile",
      });
    }
  })
  .transform((contract) => ({
    ...contract,
    outDir: contract.outDir ?? visualArtifactPath(contract.id),
  }));

export type VerificationContract = z.infer<typeof verificationContractSchema>;
export type ContractScope = z.infer<typeof contractScopeSchema>;
export type VisualMask = z.infer<typeof visualMaskSchema>;
export type ExpectStyle = z.infer<typeof expectStyleSchema>;
export type StyleCheckPoint = z.infer<typeof styleCheckPointSchema>;
export type ProfileOverrides = z.infer<typeof profileOverridesSchema>;
export type StyleToleranceOverrides = z.infer<typeof styleToleranceOverridesSchema>;
