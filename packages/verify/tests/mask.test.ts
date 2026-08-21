import { describe, expect, it } from "vitest";

import { buildMaskBitmap, countMaskedPixels } from "../src/compare/mask.ts";

describe("buildMaskBitmap", () => {
  it("returns null when there are no masks", () => {
    expect(buildMaskBitmap(10, 10, [])).toBeNull();
  });

  it("marks pixels inside a single rect", () => {
    const bitmap = buildMaskBitmap(10, 10, [{ x: 2, y: 3, width: 4, height: 2 }]);
    expect(bitmap).not.toBeNull();
    expect(bitmap![3 * 10 + 2]).toBe(1);
    expect(bitmap![4 * 10 + 5]).toBe(1);
    expect(bitmap![0]).toBe(0);
    expect(bitmap![5 * 10 + 6]).toBe(0);
  });

  it("clamps rects that extend past the canvas", () => {
    const bitmap = buildMaskBitmap(5, 5, [{ x: 3, y: 3, width: 10, height: 10 }]);
    expect(bitmap![4 * 5 + 4]).toBe(1);
    expect(bitmap!.length).toBe(25);
  });

  it("does not double count overlapping rects", () => {
    const bitmap = buildMaskBitmap(10, 10, [
      { x: 0, y: 0, width: 5, height: 5 },
      { x: 2, y: 2, width: 5, height: 5 },
    ]);
    expect(countMaskedPixels(bitmap)).toBe(5 * 5 + (5 * 5 - 3 * 3));
  });
});

describe("countMaskedPixels", () => {
  it("returns 0 for a null bitmap", () => {
    expect(countMaskedPixels(null)).toBe(0);
  });
});
