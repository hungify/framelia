import type { PNG } from "pngjs";
import { ssim } from "ssim.js";

export function ssimCompare(baseline: PNG, actual: PNG): number {
  const a = toImageData(baseline);
  const b = toImageData(actual);
  const { mssim } = ssim(a, b, { maxSize: Infinity });
  return mssim;
}

function toImageData(png: PNG): { data: Uint8ClampedArray; width: number; height: number } {
  return {
    data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength),
    width: png.width,
    height: png.height,
  };
}
