import type { DashboardEvent, DashboardRun } from "@framelia/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectRunEvents,
  shouldCloseEventsOnError,
  shouldRefreshOnRunEvent,
  useRunArtifact,
} from "../data-source.ts";

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

function dashboardEvent(runId: string): DashboardEvent {
  return { sequence: 1, runId, status: "running", timestamp: new Date().toISOString() };
}

class FakeEventSource {
  url: string;
  closed = false;
  listeners = new Map<string, (event: unknown) => void>();
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, event: unknown) {
    this.listeners.get(type)?.(event);
  }
}

describe("shouldCloseEventsOnError", () => {
  it("only closes once the run has actually finished", () => {
    expect(shouldCloseEventsOnError(undefined)).toBe(false);
    expect(shouldCloseEventsOnError(run("a"))).toBe(false);
    expect(shouldCloseEventsOnError({ ...run("a"), finishedAt: new Date().toISOString() })).toBe(
      true,
    );
  });
});

describe("shouldRefreshOnRunEvent", () => {
  it("only matches the run currently displayed", () => {
    expect(shouldRefreshOnRunEvent("a", dashboardEvent("a"))).toBe(true);
    expect(shouldRefreshOnRunEvent("a", dashboardEvent("b"))).toBe(false);
    expect(shouldRefreshOnRunEvent(undefined, dashboardEvent("a"))).toBe(false);
  });
});

describe("connectRunEvents", () => {
  it("triggers the callback only for a 'run' event matching the current run", () => {
    let current: DashboardRun | undefined = run("a");
    const onMatchingRunEvent = vi.fn<() => void>();
    const source = connectRunEvents(
      onMatchingRunEvent,
      () => current,
      FakeEventSource as unknown as typeof EventSource,
    ) as unknown as FakeEventSource;

    source.emit("run", { data: JSON.stringify(dashboardEvent("b")) });
    expect(onMatchingRunEvent).not.toHaveBeenCalled();

    source.emit("run", { data: JSON.stringify(dashboardEvent("a")) });
    expect(onMatchingRunEvent).toHaveBeenCalledTimes(1);

    current = run("changed");
    source.emit("error", {});
    expect(source.closed).toBe(false);

    current = { ...current, finishedAt: new Date().toISOString() };
    source.emit("error", {});
    expect(source.closed).toBe(true);
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
