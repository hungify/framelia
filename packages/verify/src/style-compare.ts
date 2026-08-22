import { hexColorDeltaE } from "./compare/delta-e.ts";
import {
  FONT_SIZE_TOLERANCE_PX,
  STYLE_COLOR_DELTA_E_TOLERANCE,
  STYLE_SPACING_TOLERANCE_PX,
} from "./constants.ts";
import type { StyleSnapshot } from "./figma-node-style.ts";
import type { StyleToleranceOverrides, TopIssue, TopIssueKind } from "./types.ts";

const SPACING_SIDES = ["top", "right", "bottom", "left"] as const;

interface StyleTolerance {
  maxColorDeltaE: number;
  maxSpacingDeltaPx: number;
  maxFontSizeDeltaPx: number;
}

const DEFAULT_STYLE_TOLERANCE: StyleTolerance = {
  maxColorDeltaE: STYLE_COLOR_DELTA_E_TOLERANCE,
  maxSpacingDeltaPx: STYLE_SPACING_TOLERANCE_PX,
  maxFontSizeDeltaPx: FONT_SIZE_TOLERANCE_PX,
};

/**
 * Drops explicitly-`undefined` keys before merging a contract's styleToleranceOverrides onto
 * the defaults -- mirrors compare/index.ts's definedOverrides so an override object built from
 * optional variables can't clobber a default with `undefined`.
 */
function resolveTolerance(overrides: StyleToleranceOverrides | undefined): StyleTolerance {
  if (!overrides) return DEFAULT_STYLE_TOLERANCE;
  return {
    ...DEFAULT_STYLE_TOLERANCE,
    ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)),
  };
}

/**
 * Field-by-field diff between a Figma-side and code-side StyleSnapshot.
 * A field present on only one side (e.g. padding on a non-auto-layout
 * Figma node) is a structural difference this feature doesn't judge, so
 * it's skipped rather than fabricated into a mismatch. Every issue is
 * informational-only (blocking: false) -- see caller for why.
 *
 * color/backgroundColor differences below `tolerance.maxColorDeltaE` (CIEDE2000 perceptual
 * distance) and fontSize/spacing differences below their own pixel epsilon are treated as a
 * match rather than flagged -- exact string/number equality would flag imperceptible
 * sub-pixel rounding or anti-aliasing noise as a style regression.
 */
export function compareStyles(
  expected: StyleSnapshot,
  actual: StyleSnapshot,
  toleranceOverrides?: StyleToleranceOverrides,
): TopIssue[] {
  const tolerance = resolveTolerance(toleranceOverrides);
  const issues: TopIssue[] = [];

  pushIfColorMismatch(issues, "color", expected.color, actual.color, tolerance.maxColorDeltaE);
  pushIfColorMismatch(
    issues,
    "backgroundColor",
    expected.backgroundColor,
    actual.backgroundColor,
    tolerance.maxColorDeltaE,
  );
  pushIfNumericMismatch(
    issues,
    "fontSize",
    expected.fontSize,
    actual.fontSize,
    tolerance.maxFontSizeDeltaPx,
    "style-typography",
  );
  pushIfExactMismatch(
    issues,
    "fontWeight",
    expected.fontWeight,
    actual.fontWeight,
    "style-typography",
  );
  pushIfExactMismatch(
    issues,
    "cornerRadius",
    expected.cornerRadius,
    actual.cornerRadius,
    "style-typography",
  );

  if (expected.spacing && actual.spacing) {
    for (const side of SPACING_SIDES) {
      pushIfNumericMismatch(
        issues,
        `spacing.${side}`,
        expected.spacing[side],
        actual.spacing[side],
        tolerance.maxSpacingDeltaPx,
        "style-typography",
      );
    }
  }

  return issues;
}

function pushMismatchIssue(
  issues: TopIssue[],
  field: string,
  expected: string | number,
  actual: string | number,
  kind: TopIssueKind,
): void {
  issues.push({
    severity: "low",
    kind,
    message: `style mismatch on ${field}: expected ${expected}, actual ${actual}`,
    hint: "Check the rendered element's CSS against the Figma node's style.",
    repairCandidate: true,
    blocking: false,
  });
}

function pushIfExactMismatch(
  issues: TopIssue[],
  field: string,
  expected: string | number | undefined,
  actual: string | number | undefined,
  kind: TopIssueKind,
): void {
  if (expected === undefined || actual === undefined || expected === actual) return;
  pushMismatchIssue(issues, field, expected, actual, kind);
}

function pushIfNumericMismatch(
  issues: TopIssue[],
  field: string,
  expected: number | undefined,
  actual: number | undefined,
  toleranceValue: number,
  kind: TopIssueKind,
): void {
  if (expected === undefined || actual === undefined) return;
  if (Math.abs(expected - actual) <= toleranceValue) return;
  pushMismatchIssue(issues, field, expected, actual, kind);
}

function pushIfColorMismatch(
  issues: TopIssue[],
  field: string,
  expected: string | undefined,
  actual: string | undefined,
  maxDeltaE: number,
): void {
  if (expected === undefined || actual === undefined || expected === actual) return;
  if (hexColorDeltaE(expected, actual) <= maxDeltaE) return;
  pushMismatchIssue(issues, field, expected, actual, "style-color");
}
