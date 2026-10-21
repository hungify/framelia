import * as fs from "node:fs";
import * as path from "node:path";

import type { BaselineSource, FigmaBaselineSource } from "@framelia/contracts";

import { FIGMA_BASELINE_ARTIFACT } from "../artifacts.ts";
import { CACHED_BASELINE_STYLE_GATE_SKIPPED_WARNING, DEFAULT_IMAGE_SCALE } from "../constants.ts";
import { checkBaselineStaleness } from "../staleness.ts";
import type { CaptureDefaults, ProfileName, ResolvedBaseline } from "../types.ts";
import {
  fetchBaseline,
  baselineMetaPath,
  readBaselineMeta,
  type BaselineMeta,
  type FetchBaselineOptions,
  type FetchBaselineOutcome,
} from "./figma-fetch.ts";

export interface BaselineResolveOptions<TSource extends BaselineSource = BaselineSource> {
  source: TSource;
  outDir: string;
  profile: ProfileName;
  stabilitySamples: number;
  /** Project-wide capture-tuning defaults resolved from framelia.config.ts. */
  defaults: CaptureDefaults;
}

export type BaselineResolveOutcome =
  | { ok: true; baseline: ResolvedBaseline }
  | { ok: false; error: string; message: string };

export interface BaselineProvider<TSource extends BaselineSource = BaselineSource> {
  readonly kind: TSource["kind"];
  resolve(options: BaselineResolveOptions<TSource>): Promise<BaselineResolveOutcome>;
}

type FetchBaselineFn = (options: FetchBaselineOptions) => Promise<FetchBaselineOutcome>;

export class FigmaBaselineProvider implements BaselineProvider<FigmaBaselineSource> {
  readonly kind = "figma" as const;

  constructor(
    private readonly fetchImpl: FetchBaselineFn = fetchBaseline,
    private readonly stalenessImpl: typeof checkBaselineStaleness = checkBaselineStaleness,
  ) {}

  async resolve(
    options: BaselineResolveOptions<FigmaBaselineSource>,
  ): Promise<BaselineResolveOutcome> {
    const baselinePath = path.join(options.outDir, FIGMA_BASELINE_ARTIFACT.image);
    const fetched = await this.fetchImpl({
      fileKey: options.source.fileKey,
      nodeId: options.source.nodeId,
      outPath: baselinePath,
      scale: options.source.scale,
      canvasFill: options.source.canvasFill,
    });
    if (!fetched.fetched) {
      // fetchBaseline's own message says the cached baseline on disk "remains usable" for a
      // retryable failure -- honor that instead of aborting verification outright when
      // a previously-fetched baseline is actually there to fall back to.
      if (fetched.ok && fs.existsSync(baselinePath)) {
        const cachedMeta = readBaselineMeta(baselinePath);
        const mismatch = cachedMeta ? cachedIdentityMismatch(cachedMeta, options.source) : null;
        if (cachedMeta && mismatch) {
          return {
            ok: false,
            error: "BASELINE_FETCH_FAILED",
            message: `${fetched.message} The cached baseline at ${baselinePath} cannot stand in: ${mismatch}.`,
          };
        }
        if (cachedMeta) {
          // Figma just failed, so re-checking lastModified against it would only add another
          // failing request -- judge freshness by age alone.
          const stalenessWarnings = await this.stalenessImpl(baselinePath, { offline: true });
          return {
            ok: true,
            baseline: {
              evidence: {
                kind: "figma",
                path: path.resolve(baselinePath),
                metaPath: path.resolve(baselineMetaPath(baselinePath)),
                fileKey: cachedMeta.fileKey,
                nodeId: cachedMeta.nodeId,
                fetchedAt: cachedMeta.fetchedAt,
                lastModified: cachedMeta.lastModified,
              },
              warnings: [
                ...fetched.warnings,
                `Figma baseline fetch failed (${fetched.message}); using cached baseline from ${cachedMeta.fetchedAt}.`,
                ...stalenessWarnings,
                // No node document was fetched, so there is no figmaStyle to gate on.
                CACHED_BASELINE_STYLE_GATE_SKIPPED_WARNING,
              ],
            },
          };
        }
      }
      return { ok: false, error: "BASELINE_FETCH_FAILED", message: fetched.message };
    }
    // Freshly fetched a moment ago: a staleness re-check would just repeat the Figma
    // metadata request that fetch already made, so none is run.
    return {
      ok: true,
      baseline: {
        evidence: {
          kind: "figma",
          path: path.resolve(fetched.baselinePath),
          metaPath: path.resolve(fetched.metaPath),
          fileKey: fetched.meta.fileKey,
          nodeId: fetched.meta.nodeId,
          fetchedAt: fetched.meta.fetchedAt,
          lastModified: fetched.meta.lastModified,
        },
        warnings: fetched.warnings,
        figmaStyle: fetched.figmaStyle,
      },
    };
  }
}

/**
 * Why a cached sidecar cannot stand in for the requested source, or null when it can.
 * A sidecar written before scale/canvasFill were recorded is unverifiable, so it is
 * refused too -- comparing against a baseline rendered at another scale or composited
 * onto another canvas would fail (or pass) for reasons unrelated to the page.
 */
function cachedIdentityMismatch(meta: BaselineMeta, source: FigmaBaselineSource): string | null {
  if (meta.fileKey !== source.fileKey || meta.nodeId !== source.nodeId) {
    return `it was fetched for ${meta.fileKey}/${meta.nodeId}, not ${source.fileKey}/${source.nodeId}`;
  }
  if (meta.scale === undefined || meta.canvasFill === undefined) {
    return "its sidecar predates scale/canvasFill tracking, so its render settings are unknown";
  }
  const scale = source.scale ?? DEFAULT_IMAGE_SCALE;
  if (meta.scale !== scale) {
    return `it was rendered at scale ${meta.scale}, not ${scale}`;
  }
  const canvasFill = source.canvasFill ?? null;
  if (meta.canvasFill !== canvasFill) {
    return `it was composited onto canvasFill ${meta.canvasFill ?? "(none)"}, not ${canvasFill ?? "(none)"}`;
  }
  return null;
}
