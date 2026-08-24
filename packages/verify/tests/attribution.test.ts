import { describe, expect, it } from "vitest";

import { attributeDiffRegions, type SelectorBounds } from "../src/compare/attribution.ts";
import type { DiffCluster } from "../src/compare/pixel.ts";

function cluster(x0: number, y0: number, x1: number, y1: number): DiffCluster {
  return { pixels: (x1 - x0) * (y1 - y0), bbox: { x0, y0, x1, y1 } };
}

function bounds(
  selector: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SelectorBounds {
  return { selector, x, y, width, height };
}

describe("attributeDiffRegions", () => {
  it("attributes a cluster to the selector whose bounds overlap it", () => {
    const clusters = [cluster(10, 10, 20, 20)];
    const selectors = [bounds("header", 0, 0, 15, 15)];
    expect(attributeDiffRegions(clusters, selectors)).toEqual([
      { bbox: { x0: 10, y0: 10, x1: 20, y1: 20 }, pixels: 100, selectors: ["header"] },
    ]);
  });

  it("leaves a cluster unattributed when no selector bounds overlap it", () => {
    const clusters = [cluster(10, 10, 20, 20)];
    const selectors = [bounds("footer", 100, 100, 15, 15)];
    expect(attributeDiffRegions(clusters, selectors)).toEqual([
      { bbox: { x0: 10, y0: 10, x1: 20, y1: 20 }, pixels: 100, selectors: [] },
    ]);
  });

  it("attributes a cluster to every selector it overlaps, not just the first", () => {
    const clusters = [cluster(0, 0, 30, 30)];
    const selectors = [bounds("a", 0, 0, 10, 10), bounds("b", 20, 20, 10, 10)];
    expect(attributeDiffRegions(clusters, selectors)[0]?.selectors).toEqual(["a", "b"]);
  });

  it("does not attribute selectors that merely touch a cluster's edge without overlapping area", () => {
    const clusters = [cluster(10, 10, 20, 20)];
    // Bounds start exactly where the cluster ends -- adjacent, not overlapping.
    const selectors = [bounds("adjacent", 20, 10, 10, 10)];
    expect(attributeDiffRegions(clusters, selectors)[0]?.selectors).toEqual([]);
  });

  it("returns one entry per cluster, preserving cluster order", () => {
    const clusters = [cluster(0, 0, 5, 5), cluster(50, 50, 55, 55)];
    const selectors = [bounds("second", 50, 50, 5, 5)];
    const result = attributeDiffRegions(clusters, selectors);
    expect(result).toHaveLength(2);
    expect(result[0]?.selectors).toEqual([]);
    expect(result[1]?.selectors).toEqual(["second"]);
  });
});
