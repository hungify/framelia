import type { DashboardEvent, DashboardRun } from "@framelia/contracts";
import { describe, expect, it, vi } from "vitest";

import { cacheDashboardSource } from "../src/cached-source.ts";
import type { DashboardSource } from "../src/server.ts";

function run(finished: boolean): DashboardRun {
  return {
    schemaVersion: 2,
    runId: "run-1",
    status: finished ? "passed" : "running",
    summary: {
      total: 0,
      queued: 0,
      running: 0,
      passed: 0,
      "masked-pass": 0,
      failed: 0,
      blocked: 0,
    },
    contracts: [],
    startedAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    ...(finished ? { finishedAt: "2026-08-16T00:00:01.000Z" } : {}),
  };
}

function countingSource(options: { finished: boolean; subscribable?: boolean }) {
  const listeners = new Set<(event: DashboardEvent) => void>();
  const source = {
    snapshot: vi.fn<() => DashboardRun>(() => run(options.finished)),
    files: vi.fn<() => Map<string, string>>(() => new Map([["a.png", "/abs/a.png"]])),
    ...(options.subscribable
      ? {
          subscribe: (listener: (event: DashboardEvent) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        }
      : {}),
  } satisfies DashboardSource;
  const emit = () => {
    for (const listener of listeners)
      listener({
        sequence: 1,
        runId: "run-1",
        status: "running",
        timestamp: "2026-08-16T00:00:00.000Z",
      });
  };
  return { source, emit, listeners };
}

describe("cacheDashboardSource", () => {
  it("reuses an unfinished projection only within the TTL", async () => {
    let clock = 0;
    const { source } = countingSource({ finished: false });
    const cached = cacheDashboardSource(source, { ttlMs: 100, now: () => clock });

    await cached.snapshot();
    await cached.snapshot();
    await cached.files();
    await cached.files();
    expect(source.snapshot).toHaveBeenCalledTimes(1);
    expect(source.files).toHaveBeenCalledTimes(1);

    clock = 150;
    await cached.snapshot();
    await cached.files();
    expect(source.snapshot).toHaveBeenCalledTimes(2);
    expect(source.files).toHaveBeenCalledTimes(2);
  });

  it("keeps a finished run's projection past the TTL", async () => {
    let clock = 0;
    const { source } = countingSource({ finished: true });
    const cached = cacheDashboardSource(source, { ttlMs: 100, now: () => clock });

    await cached.snapshot();
    clock = 10_000;
    await cached.snapshot();
    expect(source.snapshot).toHaveBeenCalledTimes(1);

    // files() computed after the run is known to be finished is settled too.
    await cached.files();
    clock = 20_000;
    await cached.files();
    expect(source.files).toHaveBeenCalledTimes(1);
  });

  it("invalidates immediately on a source event, even for a finished run", async () => {
    const { source, emit } = countingSource({ finished: true, subscribable: true });
    const cached = cacheDashboardSource(source, { ttlMs: 60_000 });

    await cached.snapshot();
    await cached.files();
    emit();
    await cached.snapshot();
    await cached.files();
    expect(source.snapshot).toHaveBeenCalledTimes(2);
    expect(source.files).toHaveBeenCalledTimes(2);
  });

  it("never caches a rejected computation", async () => {
    const source: DashboardSource = {
      snapshot: vi
        .fn<() => Promise<DashboardRun>>()
        .mockRejectedValueOnce(new Error("torn read"))
        .mockResolvedValue(run(true)),
      files: () => new Map(),
    };
    const cached = cacheDashboardSource(source, { ttlMs: 60_000 });
    await expect(cached.snapshot()).rejects.toThrow("torn read");
    await expect(cached.snapshot()).resolves.toMatchObject({ runId: "run-1" });
  });

  it("dispose releases its own subscription", () => {
    const { source, listeners } = countingSource({ finished: false, subscribable: true });
    const cached = cacheDashboardSource(source);
    expect(listeners.size).toBe(1);
    cached.dispose();
    expect(listeners.size).toBe(0);
  });
});
