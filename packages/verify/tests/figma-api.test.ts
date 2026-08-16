import { afterEach, describe, expect, it, vi } from "vitest";

import { NODE_META_CACHE_TTL_MS } from "../src/constants.ts";
import { clearNodeMetaCache, getNodeMetadata } from "../src/figma-api.ts";

afterEach(() => {
  clearNodeMetaCache();
  vi.useRealTimers();
});

function metadataFetch(counter: { calls: number }): typeof fetch {
  return (async () => {
    counter.calls += 1;
    return new Response(
      JSON.stringify({
        lastModified: "2026-08-01T00:00:00Z",
        nodes: { "1:2": { document: { type: "FRAME" } } },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
}

describe("Figma node metadata cache", () => {
  it("uses explicit cache option and evicts expired entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    const counter = { calls: 0 };
    const fetchImpl = metadataFetch(counter);

    await getNodeMetadata("file", "1:2", "token", { fetchImpl, cache: true });
    await getNodeMetadata("file", "1:2", "token", { fetchImpl, cache: true });
    expect(counter.calls).toBe(1);

    vi.setSystemTime(Date.now() + NODE_META_CACHE_TTL_MS + 1);
    await getNodeMetadata("file", "1:2", "token", { fetchImpl, cache: true });
    expect(counter.calls).toBe(2);
  });

  it("can disable caching for injected fetch implementations", async () => {
    const counter = { calls: 0 };
    const fetchImpl = metadataFetch(counter);
    await getNodeMetadata("file", "1:2", "token", { fetchImpl, cache: false });
    await getNodeMetadata("file", "1:2", "token", { fetchImpl, cache: false });
    expect(counter.calls).toBe(2);
  });
});
