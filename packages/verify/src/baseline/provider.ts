import * as fs from "node:fs";
import * as path from "node:path";

import type { BaselineSource, FigmaBaselineSource } from "@framelia/contracts";

import { FIGMA_BASELINE_ARTIFACT } from "../artifacts.ts";
import { checkBaselineStaleness } from "../staleness.ts";
import type { CaptureDefaults, ProfileName, ResolvedBaseline } from "../types.ts";
import {
  fetchBaseline,
  baselineMetaPath,
  readBaselineMeta,
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
      if (fetched.errorClass === "retryable" && fs.existsSync(baselinePath)) {
        const cachedMeta = readBaselineMeta(baselinePath);
        if (cachedMeta) {
          const stalenessWarnings = await this.stalenessImpl(baselinePath);
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
              ],
            },
          };
        }
      }
      return { ok: false, error: "BASELINE_FETCH_FAILED", message: fetched.message };
    }
    const stalenessWarnings = await this.stalenessImpl(baselinePath);
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
        warnings: [...fetched.warnings, ...stalenessWarnings],
        figmaStyle: fetched.figmaStyle,
      },
    };
  }
}
