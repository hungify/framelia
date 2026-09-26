import type { StyleCheckPoint, StyleToleranceOverrides } from "@framelia/contracts";
import type { DiffCluster, SelectorBounds, StyleSnapshot, TopIssue } from "@framelia/verify";
import { attributeDiffRegions, compareStyles, expectStyleToSnapshot } from "@framelia/verify";
import type { Page } from "@playwright/test";

import { captureElementBounds, captureElementStyle } from "./capture-style.ts";
import { withTimeout } from "./timeout.ts";

/**
 * Shared style-check/pixel-attribution tail used by both `toMatchFigma` (live Figma
 * fetch) and `defineFigmaTests` (pinned baseline) -- both end up with the same shape of
 * "expected style baked at authoring time" input (`ExpectStyle`/`StyleCheckPoint`,
 * bridged to a `StyleSnapshot` via `expectStyleToSnapshot`), so the comparison/timeout/
 * attribution logic below has exactly one implementation, not two that could drift.
 */

/**
 * Style comparison is best-effort and informational-only (see compareStyles):
 * a capture-style failure (stale selector, detached element, or a timeout --
 * see withStyleCheckTimeout) must never fail the match itself. It still must
 * not look identical to a clean pass, though -- a silently empty result is
 * indistinguishable from "checked and found nothing wrong" -- so a failure
 * reports itself as a single non-blocking diagnostic issue instead of
 * skipping the style issues for this run.
 */
export function styleCheckErrorIssue(message: string): TopIssue {
  return {
    severity: "low",
    kind: "style-check-error",
    message,
    repairCandidate: false,
    blocking: false,
  };
}

export async function captureStyleIssues(
  page: Page,
  selector: string,
  figmaStyle: StyleSnapshot,
  styleToleranceOverrides: StyleToleranceOverrides | undefined,
): Promise<TopIssue[]> {
  try {
    const actualStyle = await captureElementStyle(page, selector);
    return compareStyles(figmaStyle, actualStyle, styleToleranceOverrides);
  } catch (error) {
    return [
      styleCheckErrorIssue(
        `style check for "${selector}" could not run: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }
}

/**
 * Bounds one style comparison (region's single selector, or one page check-point --
 * see captureCheckPointStyleIssues, which calls this per check-point rather than once
 * for the whole batch, so a timeout on one check-point can't erase every other
 * check-point's diagnostics) by the caller's own timeoutMs -- a stale or missing
 * selector's page.$eval has no timeout of its own and can otherwise hang past the
 * caller's configured timeout, delaying score and image attachment. A timeout here
 * reports the same non-blocking style-check-error diagnostic as captureStyleIssues'
 * own catch above -- see it for why an empty result isn't safe.
 */
export async function withStyleCheckTimeout(
  work: Promise<TopIssue[]>,
  timeoutMs: number,
): Promise<TopIssue[]> {
  try {
    return await withTimeout(work, timeoutMs, "style check");
  } catch (error) {
    return [styleCheckErrorIssue(error instanceof Error ? error.message : String(error))];
  }
}

/** A check-point only has something to compare (style or attribution bounds) once its
 *  `expectStyle` baked at authoring time -- shared by captureCheckPointStyleIssues and
 *  captureCheckPointBounds so both walk the same check-point population. */
export function hasBakedExpectStyle(
  checkPoint: StyleCheckPoint,
): checkPoint is StyleCheckPoint & { expectStyle: NonNullable<StyleCheckPoint["expectStyle"]> } {
  return checkPoint.expectStyle !== undefined;
}

/**
 * Page-scope equivalent of the region-scope bake-in above: one style comparison per
 * declared check-point, each against its own baked `expectStyle` (there's no live
 * per-checkpoint Figma baseline to re-fetch at verify time -- see #26/#27). A
 * check-point whose `expectStyle` never baked at authoring time is skipped rather
 * than compared against nothing. Every resulting issue is tagged with the
 * check-point's own selector so multiple check-points stay distinguishable in
 * `topIssues` (see TopIssue.selector). The timeout is applied per check-point
 * (not once for the whole batch) so one slow/stale selector's timeout diagnostic
 * doesn't have to share a single deadline that could also starve its siblings --
 * and so its own diagnostic still gets tagged with its own selector below.
 */
export async function captureCheckPointStyleIssues(
  page: Page,
  checkPoints: StyleCheckPoint[],
  styleToleranceOverrides: StyleToleranceOverrides | undefined,
  timeoutMs: number,
): Promise<TopIssue[]> {
  const perCheckPoint = await Promise.all(
    checkPoints.filter(hasBakedExpectStyle).map(async (checkPoint) => {
      const issues = await withStyleCheckTimeout(
        captureStyleIssues(
          page,
          checkPoint.selector,
          expectStyleToSnapshot(checkPoint.expectStyle),
          styleToleranceOverrides,
        ),
        timeoutMs,
      );
      return issues.map((issue) => Object.assign({}, issue, { selector: checkPoint.selector }));
    }),
  );
  return perCheckPoint.flat();
}

/**
 * Page-scope selector bounds for every check-point with a baked expectStyle (the same
 * population captureCheckPointStyleIssues compares), captured in the same pixel space
 * as the page screenshot -- feeds attributeDiffRegions so a pixel-diff cluster can be
 * traced to the check-point(s) it overlaps. A selector that fails to resolve (stale,
 * detached, zero-size) is simply absent from the result rather than failing the batch --
 * see captureElementBounds. `scale` mirrors captureElementBounds's own capture-scale
 * parameter -- pass the same scale the page's own screenshot was captured at (1 for an
 * unscaled, CSS-px capture).
 */
export async function captureCheckPointBounds(
  page: Page,
  checkPoints: StyleCheckPoint[],
  fullPage: boolean,
  scale = 1,
): Promise<SelectorBounds[]> {
  const bounds = await Promise.all(
    checkPoints
      .filter(hasBakedExpectStyle)
      .map((checkPoint) =>
        captureElementBounds(page, checkPoint.selector, fullPage, scale).catch(() => null),
      ),
  );
  return bounds.filter((b): b is SelectorBounds => b !== null);
}

/**
 * One TopIssue per (cluster, overlapping selector) pair -- mirrors how a style
 * mismatch is tagged with exactly one selector (see TopIssue.selector) so a region
 * overlapping two check-points surfaces as two distinguishable diagnostics instead of
 * one issue with an ambiguous multi-selector list. A cluster with no overlapping
 * selector contributes nothing -- left unattributed, not guessed.
 */
export function buildAttributionIssues(
  clusters: DiffCluster[],
  selectors: SelectorBounds[],
): TopIssue[] {
  return attributeDiffRegions(clusters, selectors).flatMap((region) =>
    region.selectors.map((selector) => ({
      severity: "low" as const,
      kind: "pixel-attribution" as const,
      message: `pixel-diff region (${region.pixels}px, bbox [${region.bbox.x0},${region.bbox.y0}]-[${region.bbox.x1},${region.bbox.y1}]) overlaps style check-point "${selector}"`,
      selector,
      repairCandidate: false,
      blocking: false,
    })),
  );
}
