import type { DashboardContractResult } from "@framelia/contracts";
import { reactive, type Ref } from "vue";

import type { CanvasSize } from "./useCanvasView";

export type EvidenceKind = "baseline" | "actual" | "diff";
export type NaturalSizes = Record<EvidenceKind, CanvasSize>;

export function resolveEvidenceSize(
  contract: DashboardContractResult,
  naturalSizes: NaturalSizes,
  kind: EvidenceKind,
): CanvasSize {
  const evidence = contract[kind];
  return {
    width: evidence?.width ?? naturalSizes[kind].width,
    height: evidence?.height ?? naturalSizes[kind].height,
  };
}

/** Tracks natural/expected image sizes for baseline/actual/diff evidence and derives content bounds. */
export function useEvidenceSizing(contract: Ref<DashboardContractResult>) {
  const naturalSizes = reactive<NaturalSizes>({
    baseline: { width: 0, height: 0 },
    actual: { width: 0, height: 0 },
    diff: { width: 0, height: 0 },
  });
  const contentSize = reactive<CanvasSize>({ width: 0, height: 0 });

  function evidenceSize(kind: EvidenceKind): CanvasSize {
    return resolveEvidenceSize(contract.value, naturalSizes, kind);
  }

  function imageStyle(kind: EvidenceKind): Record<string, string | undefined> {
    const size = evidenceSize(kind);
    return {
      width: size.width ? `${size.width}px` : undefined,
      height: size.height ? `${size.height}px` : undefined,
    };
  }

  function measureContent(): boolean {
    const baseline = evidenceSize("baseline");
    const actual = evidenceSize("actual");
    const width = Math.max(baseline.width, actual.width);
    const height = Math.max(baseline.height, actual.height);
    if (!width || !height) return false;
    contentSize.width = width;
    contentSize.height = height;
    return true;
  }

  function recordNaturalSize(kind: EvidenceKind, width: number, height: number): void {
    naturalSizes[kind].width = width;
    naturalSizes[kind].height = height;
  }

  function resetSizes(): void {
    contentSize.width = 0;
    contentSize.height = 0;
    for (const size of Object.values(naturalSizes)) {
      size.width = 0;
      size.height = 0;
    }
  }

  return {
    naturalSizes,
    contentSize,
    evidenceSize,
    imageStyle,
    measureContent,
    recordNaturalSize,
    resetSizes,
  };
}
