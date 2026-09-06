import type { PNG } from "pngjs";
import { ssim } from "ssim.js";

export function ssimCompare(
  baseline: PNG,
  actual: PNG,
  maskBitmap: Uint8Array | null = null,
): number {
  const a = toImageData(baseline);
  const b = toImageData(actual);
  const { ssim_map, mssim } = ssim(a, b, { maxSize: Infinity });
  if (!maskBitmap) return mssim;

  // ssim.js's map uses "valid" windowing (confirmed empirically, not documented):
  // cell (x, y) scores the windowSize×windowSize block anchored at pixel (x, y)
  // in the source image. Recover windowSize from how much the map shrank
  // relative to the source instead of hardcoding the library's default (11px),
  // so this stays correct if that default ever changes.
  const windowSize = baseline.width - ssim_map.width + 1;
  if (windowSize <= 0) return mssim;

  // A per-window scan of the mask (windowSize² reads per map cell) is O(W·H·windowSize²)
  // — ~247M reads on a 1920×1080 image at the default 11px window. A summed-area table
  // turns each window's overlap check into 4 array reads regardless of window size.
  const maskPrefixSum = buildMaskPrefixSum(maskBitmap, baseline.width, baseline.height);

  let sum = 0;
  let count = 0;
  for (let wy = 0; wy < ssim_map.height; wy++) {
    for (let wx = 0; wx < ssim_map.width; wx++) {
      if (windowOverlapsMask(maskPrefixSum, baseline.width, wx, wy, windowSize)) continue;
      sum += ssim_map.data[wy * ssim_map.width + wx] as number;
      count += 1;
    }
  }
  // Every window touches a masked pixel (e.g. the mask spans the whole image)
  // — nothing left to disagree on, so call it a perfect match rather than NaN.
  return count === 0 ? 1 : sum / count;
}

/**
 * (width+1)x(height+1) summed-area table of masked-pixel counts, padded with a
 * leading zero row/column so any rectangle query below never needs bounds checks.
 */
function buildMaskPrefixSum(maskBitmap: Uint8Array, width: number, height: number): Uint32Array {
  const stride = width + 1;
  const prefixSum = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    const srcRow = y * width;
    const dstRow = (y + 1) * stride;
    const prevDstRow = y * stride;
    for (let x = 0; x < width; x++) {
      rowSum += maskBitmap[srcRow + x] as number;
      prefixSum[dstRow + x + 1] = (prefixSum[prevDstRow + x + 1] as number) + rowSum;
    }
  }
  return prefixSum;
}

/** A window is excluded if any pixel in its footprint is masked, not just its anchor — this is what "excludes masked regions" means at the window boundary. */
function windowOverlapsMask(
  maskPrefixSum: Uint32Array,
  imageWidth: number,
  anchorX: number,
  anchorY: number,
  windowSize: number,
): boolean {
  const stride = imageWidth + 1;
  const x0 = anchorX;
  const y0 = anchorY;
  const x1 = anchorX + windowSize;
  const y1 = anchorY + windowSize;
  const sum =
    (maskPrefixSum[y1 * stride + x1] as number) -
    (maskPrefixSum[y0 * stride + x1] as number) -
    (maskPrefixSum[y1 * stride + x0] as number) +
    (maskPrefixSum[y0 * stride + x0] as number);
  return sum > 0;
}

function toImageData(png: PNG): { data: Uint8ClampedArray; width: number; height: number } {
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    width: png.width,
    height: png.height,
  };
}
