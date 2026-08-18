import { describe, expect, it, vi } from "vitest";

import { FigmaBaselineProvider } from "../src/baseline.ts";
import type { FetchBaselineOptions, FetchBaselineOutcome } from "../src/fetch-baseline.ts";
import type { StalenessOptions } from "../src/staleness.ts";

const baselineSource = { kind: "figma" as const, fileKey: "file", nodeId: "1:2" };

describe("baseline providers", () => {
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
      });
    const provider = new FigmaBaselineProvider(
      fetchBaseline,
      vi
        .fn<(baselinePath: string, options?: StalenessOptions) => Promise<string[]>>()
        .mockResolvedValue([]),
    );
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
      },
    });
  });
});
