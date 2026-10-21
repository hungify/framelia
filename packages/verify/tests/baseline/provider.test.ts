import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { FigmaBaselineSource } from "@framelia/contracts";
import { describe, expect, it, vi } from "vitest";

import type { FetchBaselineOptions, FetchBaselineOutcome } from "../../src/baseline/figma-fetch.ts";
import { FigmaBaselineProvider } from "../../src/baseline/provider.ts";
import {
  CACHED_BASELINE_STYLE_GATE_SKIPPED_WARNING,
  STYLE_GATE_SKIPPED_PREFIX,
} from "../../src/constants.ts";
import type { StalenessOptions } from "../../src/staleness.ts";

const baselineSource: FigmaBaselineSource = { kind: "figma", fileKey: "file", nodeId: "1:2" };

describe("baseline providers", () => {
  it("rejects corrupt cached metadata after a retryable fetch failure", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-baseline-corrupt-"));
    try {
      fs.writeFileSync(path.join(tmp, "figma-baseline.png"), "cached");
      fs.writeFileSync(path.join(tmp, "figma-baseline.meta.json"), "{}");
      const provider = new FigmaBaselineProvider(
        async () => ({
          ok: true,
          fetched: false,
          errorClass: "retryable",
          message: "Figma unavailable",
          warnings: [],
        }),
        async () => [],
      );
      expect(
        await provider.resolve({
          source: baselineSource,
          outDir: tmp,
          profile: "page",
          stabilitySamples: 3,
          defaults: {},
        }),
      ).toMatchObject({ ok: false, error: "BASELINE_FETCH_FAILED" });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("maps Figma acquisition into common baseline evidence", async () => {
    const fetchBaseline = vi
      .fn<(options: FetchBaselineOptions) => Promise<FetchBaselineOutcome>>()
      .mockResolvedValue({
        ok: true,
        fetched: true,
        baselinePath: "/tmp/figma-baseline.png",
        metaPath: "/tmp/figma-baseline.meta.json",
        meta: {
          fileKey: "file",
          nodeId: "1:2",
          fetchedAt: "2026-08-01T00:00:00.000Z",
          lastModified: null,
          apiCallCount: 1,
          apiCallLog: [],
        },
        warnings: [],
        figmaStyle: { color: "#000000ff" },
      });
    const staleness = vi
      .fn<(baselinePath: string, options?: StalenessOptions) => Promise<string[]>>()
      .mockResolvedValue([]);
    const provider = new FigmaBaselineProvider(fetchBaseline, staleness);
    const result = await provider.resolve({
      source: baselineSource,
      outDir: "/tmp",
      profile: "page",
      stabilitySamples: 3,
      defaults: {},
    });
    expect(result).toMatchObject({
      ok: true,
      baseline: {
        evidence: { kind: "figma", fileKey: "file", nodeId: "1:2" },
        figmaStyle: { color: "#000000ff" },
      },
    });
    // The baseline was fetched a moment ago -- no second Figma metadata round-trip.
    expect(staleness).not.toHaveBeenCalled();
  });
});

async function unavailable(): Promise<FetchBaselineOutcome> {
  return {
    ok: true,
    fetched: false,
    errorClass: "retryable",
    message: "Figma API unavailable (500).",
    warnings: [],
  };
}

function cachedBaselineDir(meta: Record<string, unknown>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-baseline-cache-"));
  fs.writeFileSync(path.join(tmp, "figma-baseline.png"), "cached-png");
  fs.writeFileSync(
    path.join(tmp, "figma-baseline.meta.json"),
    JSON.stringify({
      fileKey: "file",
      nodeId: "1:2",
      fetchedAt: "2026-08-01T00:00:00.000Z",
      lastModified: null,
      apiCallCount: 1,
      apiCallLog: [],
      scale: 1,
      canvasFill: null,
      ...meta,
    }),
  );
  return tmp;
}

describe("cached-baseline fallback", () => {
  async function resolveFallback(
    meta: Record<string, unknown>,
    source: FigmaBaselineSource = baselineSource,
  ) {
    const outDir = cachedBaselineDir(meta);
    const staleness = vi
      .fn<(baselinePath: string, options?: StalenessOptions) => Promise<string[]>>()
      .mockResolvedValue([]);
    try {
      const result = await new FigmaBaselineProvider(unavailable, staleness).resolve({
        source,
        outDir,
        profile: "page",
        stabilitySamples: 3,
        defaults: {},
      });
      return { result, staleness };
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  it("uses a matching cached baseline, warns that the style gate is skipped, and checks staleness offline", async () => {
    const { result, staleness } = await resolveFallback({});
    expect(result).toMatchObject({ ok: true });
    const baseline = result.ok ? result.baseline : undefined;
    expect(baseline?.figmaStyle).toBeUndefined();
    expect(baseline?.warnings).toContain(CACHED_BASELINE_STYLE_GATE_SKIPPED_WARNING);
    expect(
      baseline?.warnings.some((warning) => warning.startsWith(STYLE_GATE_SKIPPED_PREFIX)),
    ).toBe(true);
    expect(staleness).toHaveBeenCalledWith(expect.any(String), { offline: true });
  });

  it.each([
    ["a different node", { nodeId: "9:9" }, baselineSource, /9:9/],
    ["a different scale", { scale: 2 }, baselineSource, /scale 2, not 1/],
    [
      "a different canvasFill",
      { canvasFill: "#000000" },
      { ...baselineSource, canvasFill: "#ffffff" },
      /canvasFill #000000/,
    ],
    ["a legacy sidecar without render settings", { scale: undefined }, baselineSource, /predates/],
  ] as const)("refuses a cached baseline fetched for %s", async (_label, meta, source, pattern) => {
    const { result, staleness } = await resolveFallback(meta, source);
    expect(result).toMatchObject({
      ok: false,
      error: "BASELINE_FETCH_FAILED",
      message: expect.stringMatching(pattern),
    });
    expect(staleness).not.toHaveBeenCalled();
  });
});
