import { describe, it, expect } from "vitest";

import { makeSolidPng } from "../src/compare/png.ts";
import { ssimCompare } from "../src/compare/ssim.ts";

describe("ssimCompare", () => {
  it("returns 1 for identical images", () => {
    const png = makeSolidPng(32, 32, [128, 128, 128, 255]);
    const result = ssimCompare(png, png);
    expect(result).toBe(1);
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
});
