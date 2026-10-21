import { describe, it, expect } from "vitest";

import { buildMaskBitmap } from "../src/compare/mask.ts";
import { makeSolidPng } from "../src/compare/png.ts";
import { ssimCompare, ssimDownsampleFactor, ssimWindowSize } from "../src/compare/ssim.ts";

describe("ssimCompare", () => {
  it("returns 1 for identical images", () => {
    const png = makeSolidPng(32, 32, [128, 128, 128, 255]);
    const result = ssimCompare(png, png);
    expect(result).toBe(1);
  });

  it("never exceeds 1 from floating-point error on identical images", () => {
    // ssim.js scores this identical pair 1.0000000000000002, which the score schema rejects.
    const png = makeSolidPng(100, 80, [20, 80, 40, 255]);
    expect(ssimCompare(png, png)).toBe(1);
  });

  it("returns less than 1 for different images", () => {
    const baseline = makeSolidPng(32, 32, [255, 255, 255, 255]);
    const actual = makeSolidPng(32, 32, [0, 0, 0, 255]);
    const result = ssimCompare(baseline, actual);
    expect(result).toBeLessThan(1);
  });

  it("detects small structural shift on 800x600 without downsample washout", () => {
    const baseline = makeSolidPng(800, 600, [240, 240, 240, 255]);
    const actual = makeSolidPng(800, 600, [240, 240, 240, 255]);
    for (let x = 100; x < 700; x++) {
      for (let y = 200; y < 201; y++) {
        const i = (800 * y + x) << 2;
        actual.data[i] = 230;
        actual.data[i + 1] = 230;
        actual.data[i + 2] = 230;
      }
    }
    const same = ssimCompare(baseline, baseline);
    const diff = ssimCompare(baseline, actual);
    expect(same).toBeGreaterThan(0.999);
    expect(diff).toBeLessThan(same - 0.001);
  });

  it("excludes a structurally different masked region from the score", () => {
    const size = 64;
    const baseline = makeSolidPng(size, size, [240, 240, 240, 255]);
    const actual = makeSolidPng(size, size, [240, 240, 240, 255]);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const i = (size * y + x) << 2;
        actual.data[i] = 0;
        actual.data[i + 1] = 0;
        actual.data[i + 2] = 0;
      }
    }
    const unmasked = ssimCompare(baseline, actual);
    expect(unmasked).toBeLessThan(1);

    const maskBitmap = buildMaskBitmap(size, size, [{ x: 0, y: 0, width: 20, height: 20 }]);
    const masked = ssimCompare(baseline, actual, maskBitmap);
    expect(masked).toBe(1);
  });

  it.each([
    [300, 1],
    [5, 40],
    [1, 1],
  ])("never throws on a %dx%d image narrower than the SSIM window", (width, height) => {
    const png = makeSolidPng(width, height, [10, 20, 30, 255]);
    expect(ssimCompare(png, png)).toBeCloseTo(1, 10);
  });

  it("still tells black from white on an 8x8 image (no silent 1.0)", () => {
    const black = makeSolidPng(8, 8, [0, 0, 0, 255]);
    const white = makeSolidPng(8, 8, [255, 255, 255, 255]);
    expect(ssimWindowSize(8, 8)).toBe(8);
    expect(ssimCompare(black, white)).toBeLessThan(0.01);
    expect(
      ssimCompare(makeSolidPng(300, 1, [0, 0, 0, 255]), makeSolidPng(300, 1, [255, 255, 255, 255])),
    ).toBeLessThan(0.01);
  });

  it("downsamples very large comparisons and keeps the mask aligned", () => {
    const width = 2600;
    const height = 2000;
    expect(ssimDownsampleFactor(width, height)).toBe(2);
    expect(ssimDownsampleFactor(1920, 1080)).toBe(1);
    // A thin, tall page never loses its short side below one window.
    expect(ssimDownsampleFactor(20, 1_000_000)).toBe(1);

    const baseline = makeSolidPng(width, height, [240, 240, 240, 255]);
    const actual = makeSolidPng(width, height, [240, 240, 240, 255]);
    // Odd-aligned region, so its downsampled footprint straddles block boundaries.
    for (let y = 101; y < 301; y++) {
      for (let x = 501; x < 801; x++) {
        const i = (width * y + x) << 2;
        actual.data[i] = 0;
        actual.data[i + 1] = 0;
        actual.data[i + 2] = 0;
      }
    }
    expect(ssimCompare(baseline, actual)).toBeLessThan(1);
    const maskBitmap = buildMaskBitmap(width, height, [
      { x: 501, y: 101, width: 300, height: 200 },
    ]);
    expect(ssimCompare(baseline, actual, maskBitmap)).toBe(1);
  });

  it("returns 1 when the entire image is masked", () => {
    const size = 32;
    const baseline = makeSolidPng(size, size, [255, 255, 255, 255]);
    const actual = makeSolidPng(size, size, [0, 0, 0, 255]);
    const maskBitmap = buildMaskBitmap(size, size, [{ x: 0, y: 0, width: size, height: size }]);
    expect(ssimCompare(baseline, actual, maskBitmap)).toBe(1);
  });
});
