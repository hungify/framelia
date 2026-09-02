import { FIGMA_BASELINE_ARTIFACT } from "./artifacts.ts";
import { readBaselineMeta } from "./baseline/figma-fetch.ts";
import { DEFAULT_MAX_BASELINE_AGE_DAYS, MS_PER_DAY } from "./constants.ts";
import { getNodeMetadata, resolveToken } from "./figma-api.ts";

export { DEFAULT_MAX_BASELINE_AGE_DAYS };

export interface StalenessOptions {
  token?: string;
  maxAgeDays?: number;
  fetchImpl?: typeof fetch;
}

export async function checkBaselineStaleness(
  baselinePath: string,
  options: StalenessOptions = {},
): Promise<string[]> {
  const warnings: string[] = [];
  const meta = readBaselineMeta(baselinePath);
  if (!meta) {
    warnings.push(
      `baseline has no ${FIGMA_BASELINE_ARTIFACT.meta} sidecar; freshness unknown; re-fetch baseline to start tracking staleness.`,
    );
    return warnings;
  }

  const token = resolveToken(options.token);
  if (token) {
    const current = await getNodeMetadata(meta.fileKey, meta.nodeId, token, {
      fetchImpl: options.fetchImpl,
    });
    if ("error" in current) {
      warnings.push(
        `baseline staleness re-check failed (${current.error}); falling back to time-based heuristic.`,
      );
    } else {
      if (current.lastModified && meta.lastModified) {
        if (current.lastModified !== meta.lastModified) {
          warnings.push(
            `baseline may be stale: Figma file lastModified ${current.lastModified} differs from baseline fetch-time value ${meta.lastModified}; re-run fetch-baseline.`,
          );
        }
        return warnings;
      }
      warnings.push(
        "baseline metadata lacks a usable lastModified value; falling back to time-based freshness.",
      );
    }
  }

  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_BASELINE_AGE_DAYS;
  const fetchedAtMs = Date.parse(meta.fetchedAt ?? "");
  if (!Number.isFinite(fetchedAtMs)) {
    warnings.push(
      "baseline sidecar has no valid fetchedAt timestamp; freshness unknown; re-run fetch-baseline.",
    );
    return warnings;
  }
  const ageMs = Date.now() - fetchedAtMs;
  const ageDays = Math.floor(ageMs / MS_PER_DAY);
  if (ageDays > maxAgeDays) {
    warnings.push(
      `baseline not re-verified in ${ageDays}d${token ? "" : ", no token to confirm freshness against Figma"} (max ${maxAgeDays}d); re-run fetch-baseline.`,
    );
  }
  return warnings;
}
