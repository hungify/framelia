import { DEFAULT_MAX_MASKED_AREA_RATIO } from "@framelia/contracts";
import type { Locator, Page } from "@playwright/test";

import type { RejectResult } from "../types.ts";
import { checkMaskAreaRatio } from "./domain/capture-rules.ts";
import { reject } from "./reject.ts";
import type { MaskBounds, MaskEvidence, ReadyCaptureSpec } from "./types.ts";
import { MASK_COLOR } from "./types.ts";

export type MaskResolution =
  | { ok: true; locators: Locator[]; evidence: MaskEvidence | null }
  | { ok: false; reject: RejectResult };

export type MaskResolutionSpec = Pick<ReadyCaptureSpec, "scope" | "screenshot">;

export async function resolveMasks(page: Page, spec: MaskResolutionSpec): Promise<MaskResolution> {
  const masks = spec.screenshot.masks ?? [];
  if (!masks.length) return { ok: true, locators: [], evidence: null };
  const resolvedAt = new Date().toISOString();
  const requested = masks.map((mask) => ({
    selector: mask.selector,
    reason: mask.reason,
    maxMatches: mask.maxMatches ?? 1,
    matchedCount: 0,
  }));
  const scope = await captureScopeBounds(page, spec);
  // A region-scope screenshot (locator.screenshot()) crops the PNG to the
  // scope element's own bounding box, so pixel (0,0) in that image is the
  // scope's (box.x, box.y) in viewport space -- rebase mask bounds onto that
  // origin so they land in the captured image's own coordinate space (what
  // compare()'s maskBounds documents it expects). Page scope needs no rebase:
  // a full-page screenshot's (0,0) is already document origin (which
  // scrollOffset below maps mask bounds onto), and a viewport screenshot's
  // (0,0) is already viewport origin (where boundingBox() already reports).
  const regionOrigin = spec.scope.kind === "region" ? { x: scope.x, y: scope.y } : { x: 0, y: 0 };
  const toImageSpace = (rects: MaskBounds[]): MaskBounds[] =>
    rects.map((rect) => ({
      x: rect.x - regionOrigin.x,
      y: rect.y - regionOrigin.y,
      width: rect.width,
      height: rect.height,
    }));
  const fail = (
    code: Extract<RejectResult["error"], `MASK_${string}`>,
    message: string,
    bounds: MaskBounds[] = [],
    matchedCount = 0,
  ): { ok: false; reject: RejectResult } => ({
    ok: false,
    reject: {
      ...reject(code, message),
      maskEvidence: {
        requested,
        matchedCount,
        bounds: toImageSpace(bounds),
        unionMaskedArea: unionArea(bounds),
        maskedAreaRatio: 0,
        maskColor: MASK_COLOR,
        status: "failed",
        code,
        message,
        resolvedAt,
      },
    },
  });
  if (scope.width <= 0 || scope.height <= 0)
    return fail("MASK_SCOPE_INVALID", "Capture scope has no positive area.");
  // boundingBox() is viewport-relative, but captureScopeBounds() reports
  // document coordinates for a fullPage scope; offset to the same space so
  // scroll position after goto()/reload doesn't misplace the scope check.
  const scrollOffset =
    spec.scope.kind === "page" && spec.scope.fullPage
      ? await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      : { x: 0, y: 0 };
  const locators: Locator[] = [];
  const bounds: MaskBounds[] = [];
  for (let maskIndex = 0; maskIndex < masks.length; maskIndex++) {
    const mask = masks[maskIndex]!;
    const locator = page.locator(mask.selector);
    // Sequential by design: fail fast on the first bad selector instead of
    // querying every remaining mask selector once one is already wrong.
    // eslint-disable-next-line no-await-in-loop
    const count = await locator.count();
    const maxMatches = mask.maxMatches ?? 1;
    requested[maskIndex]!.matchedCount = count;
    if (count === 0)
      return fail(
        "MASK_SELECTOR_NOT_FOUND",
        `Mask selector "${mask.selector}" matched 0 elements.`,
        bounds,
        count,
      );
    if (count > maxMatches)
      return fail(
        "MASK_SELECTOR_AMBIGUOUS",
        `Mask selector "${mask.selector}" matched ${count} elements; maxMatches is ${maxMatches}.`,
        bounds,
        count,
      );
    // Every match must pass anyway, so resolve visibility+bounds concurrently
    // instead of round-tripping the two checks for one element at a time.
    // Still one await per mask (not per element): the next mask must wait for
    // this one's fail-fast verdict before it's worth querying.
    // eslint-disable-next-line no-await-in-loop
    const matchChecks = await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const item = locator.nth(index);
        const [visible, box] = await Promise.all([item.isVisible(), item.boundingBox()]);
        return { visible, box };
      }),
    );
    for (let index = 0; index < matchChecks.length; index++) {
      const { visible, box } = matchChecks[index]!;
      if (!visible)
        return fail(
          "MASK_NOT_VISIBLE",
          `Mask selector "${mask.selector}" matched hidden element ${index + 1}.`,
          bounds,
          count,
        );
      if (!box || box.width <= 0 || box.height <= 0)
        return fail(
          "MASK_ZERO_SIZE",
          `Mask selector "${mask.selector}" matched element ${index + 1} without positive bounds.`,
          bounds,
          count,
        );
      const region = {
        x: box.x + scrollOffset.x,
        y: box.y + scrollOffset.y,
        width: box.width,
        height: box.height,
      };
      if (!inside(region, scope))
        return fail(
          "MASK_OUT_OF_SCOPE",
          `Mask selector "${mask.selector}" extends outside capture scope.`,
          [...bounds, region],
          count,
        );
      bounds.push(region);
    }
    locators.push(locator);
  }
  const unionMaskedArea = unionArea(bounds);
  const maskedAreaRatio = unionMaskedArea / (scope.width * scope.height);
  const cap = spec.screenshot.maxMaskedAreaRatio ?? DEFAULT_MAX_MASKED_AREA_RATIO;
  const areaReject = checkMaskAreaRatio(maskedAreaRatio, cap);
  if (areaReject) return fail("MASK_AREA_EXCEEDED", areaReject.message, bounds, bounds.length);
  return {
    ok: true,
    locators,
    evidence: {
      requested,
      matchedCount: bounds.length,
      bounds: toImageSpace(bounds),
      unionMaskedArea,
      maskedAreaRatio,
      maskColor: MASK_COLOR,
      status: "applied",
      resolvedAt,
    },
  };
}

/**
 * Bounds of what the screenshot will actually contain, for the mask-area-ratio
 * denominator. Must track page.screenshot()'s own fullPage flag in core.ts —
 * fullPage:false captures only the viewport, not the scrollable document.
 */
export async function captureScopeBounds(
  page: Page,
  spec: MaskResolutionSpec,
): Promise<MaskBounds> {
  if (spec.scope.kind === "region") {
    const box = await page.locator(spec.scope.selector).boundingBox();
    return box
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : { x: 0, y: 0, width: 0, height: 0 };
  }
  if (!spec.scope.fullPage) {
    const viewport = page.viewportSize();
    return { x: 0, y: 0, width: viewport?.width ?? 0, height: viewport?.height ?? 0 };
  }
  return page.evaluate(() => ({
    x: 0,
    y: 0,
    width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  }));
}
export function inside(inner: MaskBounds, outer: MaskBounds): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
/** Rectangle union avoids double-counting overlapping Playwright mask overlays. */
export function unionArea(bounds: MaskBounds[]): number {
  const xs = [...new Set(bounds.flatMap((box) => [box.x, box.x + box.width]))].toSorted(
    (a, b) => a - b,
  );
  let area = 0;
  for (let index = 0; index < xs.length - 1; index++) {
    const left = xs[index]!;
    const right = xs[index + 1]!;
    const intervals = bounds
      .filter((box) => box.x < right && box.x + box.width > left)
      .map((box) => [box.y, box.y + box.height] as const)
      .toSorted((a, b) => a[0] - b[0]);
    let end = -Infinity;
    for (const [top, bottom] of intervals) {
      if (bottom <= end) continue;
      area += (right - left) * (bottom - Math.max(top, end));
      end = Math.max(end, bottom);
    }
  }
  return area;
}
