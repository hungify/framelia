import * as z from "zod";

import { baselineSchema } from "./baseline.ts";
import { CONTRACT_ID_PATTERN, MAX_MASK_SELECTORS } from "./constants.ts";
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

export const pageScopeSchema = z
  .object({
    kind: z.literal("page"),
    pageReason: nonEmptyTrimmed,
  })
  .strict();

export const regionScopeSchema = z
  .object({
    kind: z.literal("region"),
    selector: nonEmptyTrimmed,
    expectSize: expectSizeSchema,
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
