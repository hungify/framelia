import { describe, expect, it, vi } from "vitest";

import { FigmaBaselineProvider } from "../src/baseline.ts";
import type { FetchGoldOptions, FetchGoldOutcome } from "../src/fetch-gold.ts";
import type { StalenessOptions } from "../src/staleness.ts";

const contract = {
  id: "login.desktop",
  baseline: { kind: "figma" as const, fileKey: "file", nodeId: "1:2" },
  viewport: { name: "desktop", width: 100, height: 80 },
  outDir: ".framelia/visual-verifications/login/desktop",
  scope: { kind: "page" as const, pageReason: "Complete screen." },
};

describe("baseline providers", () => {
  it("maps Figma acquisition into common baseline evidence", async () => {
    const fetchGold = vi
      .fn<(options: FetchGoldOptions) => Promise<FetchGoldOutcome>>()
      .mockResolvedValue({
        ok: true,
        fetched: true,
        goldPath: "/tmp/figma-gold.png",
        metaPath: "/tmp/figma-gold.meta.json",
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
      fetchGold,
      vi
        .fn<(goldPath: string, options?: StalenessOptions) => Promise<string[]>>()
        .mockResolvedValue([]),
    );
    const result = await provider.resolve({
      source: contract.baseline,
      contract,
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
