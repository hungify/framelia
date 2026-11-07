import type { DashboardEvent, DashboardRun } from "@framelia/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  coalesce,
  connectRunEvents,
  reconnectDelayMs,
  runEventAction,
  staticDataUrl,
  useRunArtifact,
  type LiveConnectionState,
} from "../data-source.ts";
import { captureReportBase, detectDashboardHost } from "../lib/dashboard-host.ts";

function run(runId: string): DashboardRun {
  return {
    schemaVersion: 2,
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
  vi.useRealTimers();
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

  it("cache-busts with the evidence digest so a rewritten same-name image reloads", () => {
    const { artifactUrl } = useRunArtifact();
    expect(artifactUrl("contracts/home/actual.png", `sha256:${"a".repeat(64)}`)).toBe(
      `/artifacts/contracts/home/actual.png?v=sha256%3A${"a".repeat(64)}`,
    );
  });
});

describe("static report URLs", () => {
  it("resolves data against the directory index.html was loaded from, not the route", () => {
    const base = captureReportBase("https://ci.example/reports/run-7/index.html#/contracts/a.b");
    expect(base).toBe("https://ci.example/reports/run-7/");
    expect(staticDataUrl("data/selected-run.json", base)).toBe(
      "https://ci.example/reports/run-7/data/selected-run.json",
    );
    expect(staticDataUrl("data/x.png", undefined)).toBe("./data/x.png");
  });

  it("detects the server-injected marker, defaulting to static without it", () => {
    const withMarker = { querySelector: () => ({}) as Element };
    const without = { querySelector: () => null };
    expect(detectDashboardHost(withMarker, false)).toBe("server");
    expect(detectDashboardHost(without, false)).toBe("static");
    expect(detectDashboardHost(without, true)).toBe("server");
    expect(detectDashboardHost(undefined, false)).toBe("server");
  });
});

function dashboardEvent(runId: string, sequence = 1): DashboardEvent {
  return { sequence, runId, status: "running", timestamp: new Date().toISOString() };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  readyState = 0;
  closed = false;
  listeners = new Map<string, (event: unknown) => void>();
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, listener);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, event: unknown = {}) {
    this.listeners.get(type)?.(event);
  }
}

describe("runEventAction", () => {
  it("refreshes for the run on screen and reloads for a different one", () => {
    expect(runEventAction("a", dashboardEvent("a"))).toBe("refresh");
    // The reconnect sync frame (sequence 0) of a re-run on the same port.
    expect(runEventAction("a", dashboardEvent("b", 0))).toBe("reload");
    expect(runEventAction(undefined, dashboardEvent("a"))).toBe("reload");
  });
});

describe("connectRunEvents", () => {
  function connect() {
    FakeEventSource.instances = [];
    const events: DashboardEvent[] = [];
    const states: LiveConnectionState[] = [];
    const timers: Array<() => void> = [];
    const connection = connectRunEvents({
      onEvent: (event) => events.push(event),
      onStateChange: (state) => states.push(state),
      EventSourceCtor: FakeEventSource as unknown as typeof EventSource,
      delay: () => 5,
      setTimer: (callback) => timers.push(callback),
      clearTimer: () => undefined,
    });
    return { connection, events, states, timers };
  }

  it("forwards every valid run event, including other runs, and ignores junk", () => {
    const { events } = connect();
    const source = FakeEventSource.instances[0]!;
    source.emit("run", { data: JSON.stringify(dashboardEvent("a")) });
    source.emit("run", { data: JSON.stringify(dashboardEvent("b", 0)) });
    source.emit("run", { data: "not json" });
    source.emit("run", { data: JSON.stringify({ runId: "a" }) });
    expect(events.map((event) => event.runId)).toEqual(["a", "b"]);
  });

  it("reports reconnecting while down and reconnects after the browser gives up", () => {
    const { states, timers } = connect();
    const first = FakeEventSource.instances[0]!;
    first.emit("open");
    // Browser-managed retry: still CONNECTING, no manual reconnect yet.
    first.readyState = 0;
    first.emit("error");
    expect(timers).toHaveLength(0);
    // Browser gave up: CLOSED -> manual reconnect with backoff.
    first.readyState = 2;
    first.emit("error");
    expect(timers).toHaveLength(1);
    timers[0]!();
    const second = FakeEventSource.instances[1]!;
    expect(second).toBeDefined();
    second.emit("open");
    expect(states).toEqual(["connecting", "open", "reconnecting", "reconnecting", "open"]);
  });

  it("stays closed once closed (a finished run no longer stops reconnects, unmount does)", () => {
    const { connection, timers } = connect();
    const source = FakeEventSource.instances[0]!;
    connection.close();
    expect(source.closed).toBe(true);
    source.emit("error");
    expect(timers).toHaveLength(0);
  });

  it("backs off exponentially up to 30s", () => {
    expect([0, 1, 2, 10].map(reconnectDelayMs)).toEqual([1_000, 2_000, 4_000, 30_000]);
  });
});

describe("coalesce", () => {
  it("collapses a burst into one call and runs once more if requested mid-flight", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const task = vi.fn<() => Promise<void>>(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const scheduled = coalesce(task, 100);
    scheduled.schedule();
    scheduled.schedule();
    scheduled.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(1);

    scheduled.schedule();
    scheduled.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(1); // still in flight: deferred, not stacked
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(task).toHaveBeenCalledTimes(2);
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

  it("surfaces readable validation details instead of adopting a malformed run", async () => {
    const malformed = { ...run("bad"), status: "exploded" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(malformed), { status: 200 })),
    );

    const { run: current, error, refresh } = useRunArtifact();
    await refresh();

    expect(current.value).toBeUndefined();
    expect(error.value).toContain("run payload rejected");
    expect(error.value).toMatch(/status: /);
  });

  it("explains a schemaVersion skew", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ...run("x"), schemaVersion: 3 }), { status: 200 }),
      ),
    );
    const { error, refresh } = useRunArtifact();
    await refresh();
    expect(error.value).toContain("written by format v3, but this reader supports v2");
  });

  it("keeps the last good run and reports a later failure as non-blocking", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<(...args: unknown[]) => Promise<Response>>()
        .mockResolvedValueOnce(new Response(JSON.stringify(run("good")), { status: 200 }))
        .mockResolvedValue(new Response("down", { status: 503, statusText: "Unavailable" })),
    );
    const { run: current, error, refreshError, refresh } = useRunArtifact();
    await refresh();
    await refresh();
    expect(current.value?.runId).toBe("good");
    expect(error.value).toBeUndefined();
    expect(refreshError.value).toBe("/api/run: 503 Unavailable");
  });
});
