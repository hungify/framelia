import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

import {
  CLUSTER_GRID,
  CLUSTER_SLACK,
  PIXEL_THRESHOLD,
  REAL_DIFF_ALPHA_MIN,
  REAL_DIFF_BLUE_MAX,
  REAL_DIFF_GREEN_MAX,
  REAL_DIFF_RED_MIN,
} from "../constants.ts";

export interface PixelResult {
  matchRatio: number;
  diffPixels: number;
  totalPixels: number;
  diff: PNG;
  worstCellMatchRatio: number;
}

export function pixelCompare(
  baseline: PNG,
  actual: PNG,
  threshold = PIXEL_THRESHOLD,
  includeAA = false,
  maskBitmap: Uint8Array | null = null,
): PixelResult {
  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  pixelmatch(baseline.data, actual.data, diff.data, width, height, { threshold, includeAA });
  const maskedPixels = clearMaskedPixels(diff, maskBitmap);
  // Recomputed from the diff buffer (not pixelmatch's own return value) so a
  // masked region cleared above is never counted, and so the denominator below
  // always matches what countRealDiffPixels sees.
  const diffPixels = countRealDiffPixels(diff);
  const totalPixels = width * height - maskedPixels;
  // A fully masked comparison has nothing left to disagree on — treat the
  // empty domain as a full match rather than failing every profile's
  // minimum-match check.
  const matchRatio = totalPixels === 0 ? 1 : 1 - diffPixels / totalPixels;
  return {
    matchRatio,
    diffPixels,
    totalPixels,
    diff,
    worstCellMatchRatio: worstGridMatchRatio(diff, CLUSTER_GRID, maskBitmap),
  };
}

/** Zeroes masked pixels in the diff buffer so every downstream reader (bbox, cluster, residual) sees them as no-diff without needing its own mask awareness. */
function clearMaskedPixels(diff: PNG, maskBitmap: Uint8Array | null): number {
  if (!maskBitmap) return 0;
  const { data } = diff;
  let count = 0;
  for (let i = 0; i < maskBitmap.length; i++) {
    if (!maskBitmap[i]) continue;
    count += 1;
    const o = i << 2;
    data[o] = 0;
    data[o + 1] = 0;
    data[o + 2] = 0;
    data[o + 3] = 0;
  }
  return count;
}

function isRealDiffPixel(data: Buffer | Uint8Array, i: number): boolean {
  return (
    (data[i] as number) > REAL_DIFF_RED_MIN &&
    (data[i + 1] as number) < REAL_DIFF_GREEN_MAX &&
    (data[i + 2] as number) < REAL_DIFF_BLUE_MAX &&
    (data[i + 3] as number) > REAL_DIFF_ALPHA_MIN
  );
}

export function worstGridMatchRatio(
  diff: PNG,
  grid = CLUSTER_GRID,
  maskBitmap: Uint8Array | null = null,
): number {
  const { width, height, data } = diff;
  const cellW = Math.ceil(width / grid);
  const cellH = Math.ceil(height / grid);
  let worst = 1;

  for (let cy = 0; cy < grid; cy++) {
    for (let cx = 0; cx < grid; cx++) {
      const x0 = cx * cellW;
      const y0 = cy * cellH;
      const x1 = Math.min(width, x0 + cellW);
      const y1 = Math.min(height, y0 + cellH);
      let cellDiff = 0;
      let cellTotal = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = width * y + x;
          if (maskBitmap?.[idx]) continue;
          cellTotal += 1;
          if (isRealDiffPixel(data, idx << 2)) cellDiff += 1;
        }
      }
      // Every pixel in this cell is masked — no signal to weigh in, skip it
      // rather than let an empty cell register as a perfect (or worst) match.
      if (cellTotal === 0) continue;
      const cellMatch = 1 - cellDiff / cellTotal;
      if (cellMatch < worst) worst = cellMatch;
    }
  }

  return worst;
}

export function clusterFails(
  matchRatio: number,
  worstCellMatchRatio: number,
  minMatch: number,
): boolean {
  return matchRatio >= minMatch && worstCellMatchRatio < minMatch - CLUSTER_SLACK;
}

export function countRealDiffPixels(diff: PNG): number {
  const { width, height, data } = diff;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      if (isRealDiffPixel(data, i)) n += 1;
    }
  }
  return n;
}

export interface DiffCluster {
  pixels: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export function largestRealDiffCluster(diff: PNG): DiffCluster | null {
  const { width, height, data } = diff;
  const seen = new Uint8Array(width * height);
  let largest: DiffCluster | null = null;

  for (let start = 0; start < seen.length; start++) {
    if (seen[start] || !isRealDiffPixel(data, start << 2)) continue;
    const stack = [start];
    seen[start] = 1;
    let pixels = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    // Inline the 4-neighbor check instead of building a short-lived array per
    // pixel: this loop can run for hundreds of thousands of pixels on a large diff.
    const visit = (next: number): void => {
      if (seen[next] || !isRealDiffPixel(data, next << 2)) return;
      seen[next] = 1;
      stack.push(next);
    };
    while (stack.length > 0) {
      const current = stack.pop()!;
      const x = current % width;
      const y = Math.floor(current / width);
      pixels += 1;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
      if (x > 0) visit(current - 1);
      if (x + 1 < width) visit(current + 1);
      if (y > 0) visit(current - width);
      if (y + 1 < height) visit(current + width);
    }
    if (!largest || pixels > largest.pixels) {
      largest = { pixels, bbox: { x0, y0, x1, y1 } };
    }
  }
  return largest;
}

export function diffBoundingBox(
  diff: PNG,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const { width, height, data } = diff;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (width * y + x) << 2;
      if (isRealDiffPixel(data, i)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
}
