import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resolveDashboardUrls } from "../src/dashboard/urls.ts";
import { UsageError } from "../src/exit.ts";
import { dashboardDevserverCommand } from "../src/internal/dashboard-devserver.ts";
import { createDashboardOutput, type DashboardOutput } from "../src/internal/dashboard-output.ts";
import type { DashboardHost } from "../src/internal/dashboard-runtime.ts";
import { createFakeProcess } from "./fake-process.ts";
import { createSelectedRun } from "./selected-run-fixture.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-dashboard-"));
beforeAll(async () => {
  fs.writeFileSync(path.join(tmp, "framelia.config.mjs"), "export default {};\n");
  await createSelectedRun(tmp, { runId: "run-test" });
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("dashboard URL derivation", () => {
  it("brackets explicit IPv6 hosts", () => {
    expect(
      resolveDashboardUrls({
        hostname: "::1",
        port: 6789,
        networkInterfaces: {},
      }),
    ).toMatchObject({
      local: ["http://[::1]:6789/"],
      browser: "http://[::1]:6789/",
    });
  });

  it("derives loopback and network URLs for a wildcard listener", () => {
    expect(
      resolveDashboardUrls({
        hostname: "0.0.0.0",
        port: 6789,
        networkInterfaces: {
          lo0: [{ address: "127.0.0.1", family: "IPv4" }],
          en0: [{ address: "192.168.1.5", family: "IPv4" }],
        },
      }),
    ).toEqual({
      local: ["http://localhost:6789/"],
      network: [{ url: "http://192.168.1.5:6789/", interfaceName: "en0" }],
      browser: "http://localhost:6789/",
    });
  });

  it("treats the whole 127.0.0.0/8 range as local, not as a network interface", () => {
    expect(
      resolveDashboardUrls({
        hostname: "127.0.0.2",
        port: 6789,
        networkInterfaces: {},
      }),
    ).toMatchObject({
      local: ["http://127.0.0.2:6789/"],
      network: [],
    });
  });
});

function fakeRuntime() {
  return createFakeProcess();
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface FakeHostOptions {
  readonly isTTY?: boolean;
  readonly openBrowser?: () => Promise<unknown>;
  readonly serverHostname?: string;
  readonly serverPort?: number;
}

function createFakeHost(options: FakeHostOptions = {}) {
  const shutdown = createDeferred<void>();
  const closeSpies: Array<() => void> = [];
  let lineListener: ((line: string) => void) | undefined;
  let listenerClosed = 0;
  const startServerSpy = vi.fn<DashboardHost["startServer"]>(async ({ hostname, port }) => {
    const closeSpy = vi.fn<() => Promise<void>>(async () => undefined);
    closeSpies.push(closeSpy);
    const serverHostname = options.serverHostname ?? hostname;
    const serverPort = options.serverPort ?? port;
    const urlHostname = serverHostname.includes(":") ? `[${serverHostname}]` : serverHostname;
    return {
      hostname: serverHostname,
      port: serverPort,
      url: `http://${urlHostname}:${serverPort}/`,
      close: closeSpy,
    };
  });
  const listenForInputSpy = vi.fn<DashboardHost["listenForInput"]>((listener) => {
    if (!(options.isTTY ?? false)) return undefined;
    lineListener = listener;
    return () => {
      listenerClosed += 1;
    };
  });
  const host: DashboardHost = {
    startServer: startServerSpy,
    networkContext: async () => ({
      localhostAlias: undefined,
      networkInterfaces: {},
    }),
    openBrowser: vi.fn<DashboardHost["openBrowser"]>(
      options.openBrowser ?? (async () => undefined),
    ),
    listenForInput: listenForInputSpy,
    now: () => 0,
    waitForShutdown: () => shutdown.promise,
  };
  return {
    host,
    startServerSpy,
    listenForInputSpy,
    closeSpies,
    triggerShutdown: () => shutdown.resolve(),
    emitLine: (line: string) => lineListener?.(line),
    listenerClosedCount: () => listenerClosed,
  };
}

function createFakeOutput(): DashboardOutput {
  return {
    ready: vi.fn<DashboardOutput["ready"]>(),
    localUrl: vi.fn<DashboardOutput["localUrl"]>(),
    shortcutHint: vi.fn<DashboardOutput["shortcutHint"]>(),
    shortcuts: vi.fn<DashboardOutput["shortcuts"]>(),
    restarting: vi.fn<DashboardOutput["restarting"]>(),
    clear: vi.fn<DashboardOutput["clear"]>(),
  };
}

const baseDashboardOptions = {
  run: "run-test",
  projectRoot: undefined,
  host: undefined,
  port: 6789,
  noOpen: true,
};

describe("dashboard: port validation", () => {
  it("rejects a non-positive port before starting any server", async () => {
    const { host, startServerSpy } = createFakeHost();
    const output = createFakeOutput();
    await expect(
      dashboardDevserverCommand(
        { ...baseDashboardOptions, projectRoot: tmp, port: -1 },
        fakeRuntime(),
        host,
        output,
      ),
    ).rejects.toBeInstanceOf(UsageError);
    expect(startServerSpy).not.toHaveBeenCalled();
  });
});

describe("dashboard output: stream targeting", () => {
  it("writes the banner and the clear sequence to the same stream, so redirecting stdout cannot swallow either", () => {
    const runtime = createFakeProcess();
    const output = createDashboardOutput(runtime);
    output.ready({
      elapsedMs: 1,
      localUrls: ["http://localhost:6789/"],
      networkUrls: [],
      hostExplicit: false,
    });
    output.clear();
    expect(runtime.stdoutText()).toBe("");
    expect(runtime.stderrText()).toContain("http://localhost:6789/");
    expect(runtime.stderrText()).toContain("\x1Bc");
  });
});

describe("dashboard: lifecycle", () => {
  it("starts a server, shows the ready banner, and shuts down gracefully on an external shutdown signal", async () => {
    const { host, triggerShutdown, closeSpies } = createFakeHost();
    const output = createFakeOutput();
    triggerShutdown();
    await dashboardDevserverCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      output,
    );
    expect(output.ready).toHaveBeenCalledTimes(1);
    expect(closeSpies).toHaveLength(1);
    expect(closeSpies[0]).toHaveBeenCalledTimes(1);
  });

  it("uses the listener's structured port in displayed URLs", async () => {
    const { host, triggerShutdown } = createFakeHost({ serverPort: 80 });
    const output = createFakeOutput();
    triggerShutdown();
    await dashboardDevserverCommand(
      { ...baseDashboardOptions, projectRoot: tmp, port: 80 },
      fakeRuntime(),
      host,
      output,
    );
    expect(output.ready).toHaveBeenCalledWith(
      expect.objectContaining({ localUrls: ["http://localhost:80/"] }),
    );
  });

  it("does not show shortcut controls when terminal input is unavailable", async () => {
    const { host, triggerShutdown } = createFakeHost({ isTTY: false });
    const output = createFakeOutput();
    triggerShutdown();
    await dashboardDevserverCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      output,
    );
    expect(output.shortcutHint).not.toHaveBeenCalled();
  });

  it("swallows a browser-open failure instead of crashing the dashboard (documented improvement)", async () => {
    const { host, triggerShutdown } = createFakeHost({
      isTTY: false,
      openBrowser: () => Promise.reject(new Error("no display available")),
    });
    triggerShutdown();
    await expect(
      dashboardDevserverCommand(
        { ...baseDashboardOptions, projectRoot: tmp, noOpen: false },
        fakeRuntime(),
        host,
        createFakeOutput(),
      ),
    ).resolves.toBeUndefined();
  });

  it("'r' restarts the server (closes the old one, starts a new one) without ending the command", async () => {
    const { host, startServerSpy, closeSpies, emitLine, triggerShutdown } = createFakeHost({
      isTTY: true,
    });
    const output = createFakeOutput();
    const done = dashboardDevserverCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      output,
    );
    await vi.waitFor(() => expect(startServerSpy).toHaveBeenCalledTimes(1));
    emitLine("r");
    await vi.waitFor(() => expect(closeSpies).toHaveLength(1));
    await vi.waitFor(() => expect(startServerSpy).toHaveBeenCalledTimes(2));
    expect(output.restarting).toHaveBeenCalledTimes(1);
    triggerShutdown();
    await done;
    expect(closeSpies).toHaveLength(2);
  });

  it("'q' quits gracefully -- closes the server exactly once and resolves without an external shutdown", async () => {
    const { host, closeSpies, emitLine } = createFakeHost({ isTTY: true });
    const done = dashboardDevserverCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      createFakeOutput(),
    );
    await vi.waitFor(() => expect(host.startServer).toHaveBeenCalledTimes(1));
    emitLine("q");
    await expect(done).resolves.toBeUndefined();
    expect(closeSpies).toHaveLength(1);
    expect(closeSpies[0]).toHaveBeenCalledTimes(1);
  });

  it("closes the terminal input listener on shutdown", async () => {
    const { host, triggerShutdown, listenerClosedCount } = createFakeHost({ isTTY: true });
    triggerShutdown();
    await dashboardDevserverCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      createFakeOutput(),
    );
    expect(listenerClosedCount()).toBe(1);
  });

  it("'h' lists all shortcuts (not itself one of them) without ending the command", async () => {
    const { host, emitLine, triggerShutdown } = createFakeHost({ isTTY: true });
    const output = createFakeOutput();
    const done = dashboardDevserverCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      output,
    );
    await vi.waitFor(() => expect(host.startServer).toHaveBeenCalledTimes(1));
    emitLine("h");
    await vi.waitFor(() => expect(output.shortcuts).toHaveBeenCalledTimes(1));
    const call = vi.mocked(output.shortcuts).mock.calls[0];
    expect(call?.[0].map((s) => s.key)).toEqual(["r", "u", "o", "c", "q"]);
    triggerShutdown();
    await done;
  });
});
