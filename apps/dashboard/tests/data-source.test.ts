import type { DashboardRun } from "@framelia/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRunArtifact } from "../data-source.ts";

function run(runId: string): DashboardRun {
  return {
    schemaVersion: 1,
    runId,
    status: "running",
    summary: { total: 0, passed: 0, failed: 0, blocked: 0, running: 0, queued: 0 },
    contracts: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("artifactUrl", () => {
  it("rejects path-traversal segments instead of building an escaping URL", () => {
    const { artifactUrl } = useRunArtifact();
    expect(artifactUrl("../../etc/passwd")).toBe("");
    expect(artifactUrl("contracts/../../secret")).toBe("");
    expect(artifactUrl("contracts/./actual.png")).toBe("");
    expect(artifactUrl("")).toBe("");
  });

  it("encodes an ordinary relative path unchanged in shape", () => {
    const { artifactUrl } = useRunArtifact();
    expect(artifactUrl("contracts/home desktop/actual.png")).toBe(
      "/artifacts/contracts/home%20desktop/actual.png",
    );
  });
});

describe("refresh", () => {
  it("drops a slower, earlier-started fetch's result once a newer refresh has resolved", async () => {
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => (resolveFirst = resolve));
    const second = Promise.resolve(new Response(JSON.stringify(run("second")), { status: 200 }));
    const fetchMock = vi
      .fn<(...args: unknown[]) => Promise<Response>>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    vi.stubGlobal("fetch", fetchMock);

    const { run: current, refresh } = useRunArtifact();
    const firstRefresh = refresh();
    const secondRefresh = refresh();
    await secondRefresh;
    expect(current.value?.runId).toBe("second");

    resolveFirst(new Response(JSON.stringify(run("first")), { status: 200 }));
    await firstRefresh;
    expect(current.value?.runId).toBe("second");
  });
});
