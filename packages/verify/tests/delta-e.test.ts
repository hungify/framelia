import { describe, it, expect } from "vitest";

import { avgDeltaE2000 } from "../src/compare/delta-e.ts";
import { buildMaskBitmap } from "../src/compare/mask.ts";
import { makeSolidPng } from "../src/compare/png.ts";

describe("avgDeltaE2000", () => {
  it("returns 0 for identical images", () => {
    const png = makeSolidPng(10, 10, [128, 128, 128, 255]);
    const result = avgDeltaE2000(png, png, { x0: 0, y0: 0, x1: 10, y1: 10 });
    expect(result).toBe(0);
  });

  it("detects color difference", () => {
    const baseline = makeSolidPng(10, 10, [255, 0, 0, 255]);
    const actual = makeSolidPng(10, 10, [0, 0, 255, 255]);
    const result = avgDeltaE2000(baseline, actual, { x0: 0, y0: 0, x1: 10, y1: 10 });
    expect(result).toBeGreaterThan(0);
  });

  it("samples with stride when bbox is large", () => {
    const baseline = makeSolidPng(10, 10, [100, 150, 200, 255]);
    const actual = makeSolidPng(10, 10, [100, 150, 200, 255]);
    for (let y = 0; y < actual.height; y++) {
      for (let x = 1; x < actual.width; x += 2) {
        const offset = (actual.width * y + x) << 2;
        actual.data[offset] = 255;
      }
    }
    const result = avgDeltaE2000(baseline, actual, { x0: 0, y0: 0, x1: 10, y1: 10 }, 25);
    expect(result).toBe(0);
  });

  it("excludes masked pixels from the average within the bbox", () => {
    const baseline = makeSolidPng(10, 10, [255, 0, 0, 255]);
    const actual = makeSolidPng(10, 10, [0, 0, 255, 255]);
    const bbox = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const unmasked = avgDeltaE2000(baseline, actual, bbox);
    expect(unmasked).toBeGreaterThan(0);

    const maskBitmap = buildMaskBitmap(10, 10, [{ x: 0, y: 0, width: 10, height: 10 }]);
    const masked = avgDeltaE2000(baseline, actual, bbox, undefined, maskBitmap);
    expect(masked).toBe(0);
  });

  it("rejects mismatched image dimensions", () => {
    const baseline = makeSolidPng(10, 10, [0, 0, 0, 255]);
    const actual = makeSolidPng(9, 10, [0, 0, 0, 255]);
    expect(() => avgDeltaE2000(baseline, actual, { x0: 0, y0: 0, x1: 9, y1: 10 })).toThrow(
      /requires equal dimensions/,
    );
  });
});
