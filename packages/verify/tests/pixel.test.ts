import { describe, it, expect } from "vitest";

import { buildMaskBitmap } from "../src/compare/mask.ts";
import {
  countRealDiffPixels,
  diffBoundingBox,
  largestRealDiffCluster,
  pixelCompare,
} from "../src/compare/pixel.ts";
import { makeSolidPng } from "../src/compare/png.ts";

describe("countRealDiffPixels", () => {
  it("returns 0 for a black (no diff) image", () => {
    const png = makeSolidPng(10, 10, [0, 0, 0, 255]);
    expect(countRealDiffPixels(png)).toBe(0);
  });

  it("keeps anti-alias yellow out of real-diff counts", () => {
    const aaDiff = makeSolidPng(1, 1, [255, 255, 0, 255]);
    expect(countRealDiffPixels(aaDiff)).toBe(0);
  });
});

describe("pixelCompare", () => {
  it("defaults includeAA to false", () => {
    const baseline = makeSolidPng(3, 3, [0, 0, 0, 255]);
    const actual = makeSolidPng(3, 3, [0, 0, 0, 255]);
    actual.data[(3 * 1 + 1) << 2] = 255;
    actual.data[((3 * 1 + 1) << 2) + 1] = 255;
    actual.data[((3 * 1 + 1) << 2) + 2] = 255;
    expect(pixelCompare(baseline, actual).diffPixels).toBe(
      pixelCompare(baseline, actual, undefined, false).diffPixels,
    );
  });

  it("excludes a masked region entirely from matchRatio and diffPixels", () => {
    const baseline = makeSolidPng(10, 10, [0, 0, 0, 255]);
    const actual = makeSolidPng(10, 10, [0, 0, 0, 255]);
    // Paint a wildly different region — this is what a legitimate mask over
    // dynamic content (avatar, live data) would otherwise be penalized for.
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const i = (10 * y + x) << 2;
        actual.data[i] = 255;
        actual.data[i + 1] = 0;
        actual.data[i + 2] = 255;
      }
    }
    const maskBitmap = buildMaskBitmap(10, 10, [{ x: 0, y: 0, width: 4, height: 4 }]);
    const masked = pixelCompare(baseline, actual, undefined, false, maskBitmap);
    expect(masked.matchRatio).toBe(1);
    expect(masked.diffPixels).toBe(0);
    expect(masked.totalPixels).toBe(100 - 16);

    const unmasked = pixelCompare(baseline, actual);
    expect(unmasked.matchRatio).toBeLessThan(1);
  });

  it("excludes masked pixels from the cluster grid denominator", () => {
    const baseline = makeSolidPng(4, 4, [0, 0, 0, 255]);
    const actual = makeSolidPng(4, 4, [0, 0, 0, 255]);
    for (let i = 0; i < 4 * 4; i++) {
      const o = i << 2;
      actual.data[o] = 255;
    }
    // Mask everything: no cell has any unmasked pixel left to disagree on.
    const maskBitmap = buildMaskBitmap(4, 4, [{ x: 0, y: 0, width: 4, height: 4 }]);
    const masked = pixelCompare(baseline, actual, undefined, false, maskBitmap);
    expect(masked.worstCellMatchRatio).toBe(1);
  });

  it("treats a fully masked comparison as a full match, not a zero-pixel failure", () => {
    const baseline = makeSolidPng(4, 4, [0, 0, 0, 255]);
    const actual = makeSolidPng(4, 4, [255, 255, 255, 255]);
    const maskBitmap = buildMaskBitmap(4, 4, [{ x: 0, y: 0, width: 4, height: 4 }]);
    const masked = pixelCompare(baseline, actual, undefined, false, maskBitmap);
    expect(masked.totalPixels).toBe(0);
    expect(masked.matchRatio).toBe(1);
  });
});

describe("diffBoundingBox", () => {
  it("returns null for no diff pixels", () => {
    const png = makeSolidPng(10, 10, [0, 0, 0, 255]);
    expect(diffBoundingBox(png)).toBeNull();
  });
});

describe("largestRealDiffCluster", () => {
  it("returns null for empty image", () => {
    const png = makeSolidPng(10, 10, [0, 0, 0, 255]);
    expect(largestRealDiffCluster(png)).toBeNull();
  });
});
