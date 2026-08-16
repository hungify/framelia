import type { PNG } from "pngjs";

export interface AreaGapResult {
  areaGapPercent: number;
  goldSize: { width: number; height: number };
  actualSize: { width: number; height: number };
}

export function areaGap(gold: PNG, actual: PNG): AreaGapResult {
  const gw = gold.width;
  const gh = gold.height;
  const aw = actual.width;
  const ah = actual.height;
  if (gw === 0 || gh === 0) {
    return {
      areaGapPercent: 100,
      goldSize: { width: gw, height: gh },
      actualSize: { width: aw, height: ah },
    };
  }
  const gapW = (Math.abs(aw - gw) / gw) * 100;
  const gapH = (Math.abs(ah - gh) / gh) * 100;
  return {
    areaGapPercent: Math.max(gapW, gapH),
    goldSize: { width: gw, height: gh },
    actualSize: { width: aw, height: ah },
  };
}
