import type { StyleSnapshot } from "./figma-node-style.ts";
import type { TopIssue, TopIssueKind } from "./types.ts";

const SPACING_SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * Field-by-field diff between a Figma-side and code-side StyleSnapshot.
 * A field present on only one side (e.g. padding on a non-auto-layout
 * Figma node) is a structural difference this feature doesn't judge, so
 * it's skipped rather than fabricated into a mismatch. Every issue is
 * informational-only (blocking: false) -- see caller for why.
 */
export function compareStyles(expected: StyleSnapshot, actual: StyleSnapshot): TopIssue[] {
  const issues: TopIssue[] = [];

  pushIfMismatch(issues, "color", expected.color, actual.color, "style-color");
  pushIfMismatch(
    issues,
    "backgroundColor",
    expected.backgroundColor,
    actual.backgroundColor,
    "style-color",
  );
  pushIfMismatch(issues, "fontSize", expected.fontSize, actual.fontSize, "style-typography");
  pushIfMismatch(issues, "fontWeight", expected.fontWeight, actual.fontWeight, "style-typography");
  pushIfMismatch(
    issues,
    "cornerRadius",
    expected.cornerRadius,
    actual.cornerRadius,
    "style-typography",
  );

  if (expected.spacing && actual.spacing) {
    for (const side of SPACING_SIDES) {
      pushIfMismatch(
        issues,
        `spacing.${side}`,
        expected.spacing[side],
        actual.spacing[side],
        "style-typography",
      );
    }
  }

  return issues;
}

function pushIfMismatch(
  issues: TopIssue[],
  field: string,
  expected: string | number | undefined,
  actual: string | number | undefined,
  kind: TopIssueKind,
): void {
  if (expected === undefined || actual === undefined || expected === actual) return;
  issues.push({
    severity: "low",
    kind,
    message: `style mismatch on ${field}: expected ${expected}, actual ${actual}`,
    hint: "Check the rendered element's CSS against the Figma node's style.",
    repairCandidate: true,
    blocking: false,
  });
}
