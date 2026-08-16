import { GOLD_ARTIFACT } from "./artifacts.ts";
import { DEFAULT_MAX_GOLD_AGE_DAYS, MS_PER_DAY } from "./constants.ts";
import { readGoldMeta } from "./fetch-gold.ts";
import { getNodeMetadata, resolveToken } from "./figma-api.ts";

export { DEFAULT_MAX_GOLD_AGE_DAYS };

export interface StalenessOptions {
  token?: string;
  maxAgeDays?: number;
  fetchImpl?: typeof fetch;
}

export async function checkGoldStaleness(
  goldPath: string,
  options: StalenessOptions = {},
): Promise<string[]> {
  const warnings: string[] = [];
  const meta = readGoldMeta(goldPath);
  if (!meta) {
    warnings.push(
      `gold has no ${GOLD_ARTIFACT.meta} sidecar; freshness unknown; re-fetch gold to start tracking staleness.`,
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
        `gold staleness re-check failed (${current.error}); falling back to time-based heuristic.`,
      );
    } else {
      if (current.lastModified && meta.lastModified) {
        if (current.lastModified !== meta.lastModified) {
          warnings.push(
            `gold may be stale: Figma file lastModified ${current.lastModified} differs from gold fetch-time value ${meta.lastModified}; re-run fetch-gold.`,
          );
        }
        return warnings;
      }
      warnings.push(
        "gold metadata lacks a usable lastModified value; falling back to time-based freshness.",
      );
    }
  }

  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_GOLD_AGE_DAYS;
  const fetchedAtMs = Date.parse(meta.fetchedAt ?? "");
  if (!Number.isFinite(fetchedAtMs)) {
    warnings.push(
      "gold sidecar has no valid fetchedAt timestamp; freshness unknown; re-run fetch-gold.",
    );
    return warnings;
  }
  const ageMs = Date.now() - fetchedAtMs;
  const ageDays = Math.floor(ageMs / MS_PER_DAY);
  if (ageDays > maxAgeDays) {
    warnings.push(
      `gold not re-verified in ${ageDays}d${token ? "" : ", no token to confirm freshness against Figma"} (max ${maxAgeDays}d); re-run fetch-gold.`,
    );
  }
  return warnings;
}
