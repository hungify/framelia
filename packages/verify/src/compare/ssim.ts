import type { PNG } from "pngjs";
import { ssim } from "ssim.js";

/** The standard SSIM window (and ssim.js's default). */
export const SSIM_WINDOW_SIZE = 11;
/**
 * Pixel budget for one SSIM pass. ssim.js holds several full-size per-pixel arrays
 * (grayscale as a plain JS array plus Int32 summed-area tables), so a tall full-page
 * capture at DPR 2 (~3840x40000) would need gigabytes. ~4MP keeps a 2560x1600 page at
 * full resolution and box-downsamples anything larger by an integer factor.
 */
export const SSIM_MAX_PIXELS = 4_000_000;

/**
 * The window SSIM can actually use for an image this size. ssim.js's "valid" windowing
 * throws (negative typed-array length) or silently reports 1 when a side is shorter than
 * the window, so the window shrinks to the short side instead. At the 1px floor SSIM
 * reduces to its per-pixel luminance term -- still a real similarity signal (black vs
 * white scores ~0), just without the structure/contrast terms a larger window adds.
 */
export function ssimWindowSize(width: number, height: number): number {
  return Math.max(1, Math.min(SSIM_WINDOW_SIZE, width, height));
}

/** Integer box-downsample factor that fits SSIM_MAX_PIXELS without shrinking the short
 *  side below one full window. 1 = full resolution. */
export function ssimDownsampleFactor(width: number, height: number): number {
  const pixels = width * height;
  if (pixels <= SSIM_MAX_PIXELS) return 1;
  const wanted = Math.ceil(Math.sqrt(pixels / SSIM_MAX_PIXELS));
  const limit = Math.max(1, Math.floor(Math.min(width, height) / SSIM_WINDOW_SIZE));
  return Math.min(wanted, limit);
}

export function ssimCompare(
  baseline: PNG,
  actual: PNG,
  maskBitmap: Uint8Array | null = null,
): number {
  // ssim.js can land a hair outside [0, 1] from floating-point error (identical images
  // score 1.0000000000000002), which the score schema rejects at publication time.
  return Math.min(1, Math.max(0, rawSsim(baseline, actual, maskBitmap)));
}

function rawSsim(baseline: PNG, actual: PNG, maskBitmap: Uint8Array | null): number {
  if (baseline.width === 0 || baseline.height === 0) return 1;
  // Downsampling happens here, not inside ssim.js (maxSize: Infinity disables its own),
  // so the mask is shrunk with exactly the same block mapping as the pixels and the
  // window-overlap check below stays in one coordinate space.
  const factor = ssimDownsampleFactor(baseline.width, baseline.height);
  const a = factor > 1 ? boxDownsample(baseline, factor) : toImageData(baseline);
  const b = factor > 1 ? boxDownsample(actual, factor) : toImageData(actual);
  const mask =
    maskBitmap && factor > 1
      ? downsampleMask(maskBitmap, baseline.width, baseline.height, factor)
      : maskBitmap;
  const { width, height } = a;
  const windowSize = ssimWindowSize(width, height);
  const { ssim_map, mssim } = ssim(a, b, { maxSize: Infinity, windowSize });
  if (!mask) return mssim;

  // ssim.js's map uses "valid" windowing (confirmed empirically, not documented):
  // cell (x, y) scores the windowSize×windowSize block anchored at pixel (x, y)
  // in the (possibly downsampled) source image.
  // A per-window scan of the mask (windowSize² reads per map cell) is O(W·H·windowSize²)
  // — ~247M reads on a 1920×1080 image at the default 11px window. A summed-area table
  // turns each window's overlap check into 4 array reads regardless of window size.
  const maskPrefixSum = buildMaskPrefixSum(mask, width, height);

  let sum = 0;
  let count = 0;
  for (let wy = 0; wy < ssim_map.height; wy++) {
    for (let wx = 0; wx < ssim_map.width; wx++) {
      if (windowOverlapsMask(maskPrefixSum, width, wx, wy, windowSize)) continue;
      sum += ssim_map.data[wy * ssim_map.width + wx] as number;
      count += 1;
    }
  }
  // Every window touches a masked pixel (e.g. the mask spans the whole image)
  // — nothing left to disagree on, so call it a perfect match rather than NaN.
  return count === 0 ? 1 : sum / count;
}

/** Averages each factor×factor block (edge blocks average the pixels they have). */
function boxDownsample(
  png: PNG,
  factor: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const width = Math.ceil(png.width / factor);
  const height = Math.ceil(png.height / factor);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let oy = 0; oy < height; oy++) {
    const y0 = oy * factor;
    const y1 = Math.min(png.height, y0 + factor);
    for (let ox = 0; ox < width; ox++) {
      const x0 = ox * factor;
      const x1 = Math.min(png.width, x0 + factor);
      let r = 0;
      let g = 0;
      let bl = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (png.width * y + x) << 2;
          r += png.data[i] as number;
          g += png.data[i + 1] as number;
          bl += png.data[i + 2] as number;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (width * oy + ox) << 2;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = bl / n;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

/** A downsampled cell is masked when any source pixel in its block is (conservative). */
function downsampleMask(
  maskBitmap: Uint8Array,
  width: number,
  height: number,
  factor: number,
): Uint8Array {
  const outWidth = Math.ceil(width / factor);
  const out = new Uint8Array(outWidth * Math.ceil(height / factor));
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / factor) * outWidth;
    for (let x = 0; x < width; x++) {
      if (maskBitmap[y * width + x]) out[row + Math.floor(x / factor)] = 1;
    }
  }
  return out;
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
