import type { MaskBounds } from "../capture/types.ts";

export type { MaskBounds };

/**
 * One byte per pixel of the aligned comparison canvas, built once per compare()
 * call and shared across pixel/SSIM/deltaE so a masked region is excluded
 * identically by every signal instead of each recomputing its own rounding.
 */
export function buildMaskBitmap(
  width: number,
  height: number,
  masks: MaskBounds[],
): Uint8Array | null {
  if (!masks.length) return null;
  const bitmap = new Uint8Array(width * height);
  for (const rect of masks) {
    const x0 = Math.max(0, Math.floor(rect.x));
    const y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
    const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      for (let x = x0; x < x1; x++) bitmap[row + x] = 1;
    }
  }
  return bitmap;
}

export function countMaskedPixels(bitmap: Uint8Array | null): number {
  if (!bitmap) return 0;
  let count = 0;
  for (let i = 0; i < bitmap.length; i++) if (bitmap[i]) count += 1;
  return count;
}
