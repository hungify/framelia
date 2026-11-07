export interface AreaGapResult {
  areaGapPercent: number;
  baselineSize: { width: number; height: number };
  actualSize: { width: number; height: number };
}

interface Size {
  width: number;
  height: number;
}

/**
 * Per-axis relative size gap (the larger of the width and height gaps, in percent).
 * Takes plain sizes (a PNG satisfies this structurally) so compare() and the
 * selected-run gate judge a score's size gap with the exact same formula.
 */
export function areaGap(baseline: Size, actual: Size): AreaGapResult {
  const gw = baseline.width;
  const gh = baseline.height;
  const aw = actual.width;
  const ah = actual.height;
  if (gw === 0 || gh === 0) {
    return {
      areaGapPercent: 100,
      baselineSize: { width: gw, height: gh },
      actualSize: { width: aw, height: ah },
    };
  }
  const gapW = (Math.abs(aw - gw) / gw) * 100;
  const gapH = (Math.abs(ah - gh) / gh) * 100;
  return {
    areaGapPercent: Math.max(gapW, gapH),
    baselineSize: { width: gw, height: gh },
    actualSize: { width: aw, height: ah },
  };
}
