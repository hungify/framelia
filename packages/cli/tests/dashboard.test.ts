import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { VerificationArtifact, VerificationContract } from "@framelia/contracts";
import { SCHEMA_VERSION } from "@framelia/contracts";
import { afterAll, describe, expect, it, vi } from "vitest";

import type { DashboardHost } from "../src/dashboard-types.ts";
import { UsageError } from "../src/errors.ts";
import { openCommand, runAggregatedDashboardCommand } from "../src/internal/dashboard-devserver.ts";
import type { DashboardOutput } from "../src/internal/dashboard-output.ts";
import { createFakeProcess } from "./fake-process.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-cli-dashboard-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

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
  /** Overrides the started server's advertised URL (defaults to a distinct port per start). */
  readonly serverUrl?: string;
}

/** A deterministic `DashboardHost`: no real server/DNS/browser/readline, and shutdown is
 * a promise this test resolves explicitly instead of a real signal listener -- this is
 * what lets dashboard lifecycle tests finish immediately instead of hanging, per the
 * plan's explicit "verification itself cannot hang" requirement. */
function createFakeHost(options: FakeHostOptions = {}) {
  const shutdown = createDeferred<void>();
  const closeSpies: Array<() => void> = [];
  let lineListener: ((line: string) => void) | undefined;
  let readlineClosed = 0;
  const startServerSpy = vi.fn<DashboardHost["startServer"]>(async () => {
    const closeSpy = vi.fn<() => Promise<void>>(async () => undefined);
    closeSpies.push(closeSpy);
    return {
      url: options.serverUrl ?? `http://localhost:${5000 + closeSpies.length}/`,
      close: closeSpy,
    };
  });
  const createReadlineSpy = vi.fn<DashboardHost["createReadline"]>(() => ({
    on: (event: string, listener: (line: string) => void) => {
      if (event === "line") lineListener = listener;
    },
    close: () => {
      readlineClosed += 1;
    },
  }));
  const host: DashboardHost = {
    startServer: startServerSpy,
    lookupLocalhost: async () => undefined,
    networkInterfaces: () => ({}),
    openBrowser: vi.fn<DashboardHost["openBrowser"]>(
      options.openBrowser ?? (async () => undefined),
    ),
    isTTY: () => options.isTTY ?? false,
    stdin: process.stdin,
    createReadline: createReadlineSpy,
    now: () => 0,
    waitForShutdown: () => shutdown.promise,
  };
  return {
    host,
    startServerSpy,
    createReadlineSpy,
    closeSpies,
    triggerShutdown: () => shutdown.resolve(),
    emitLine: (line: string) => lineListener?.(line),
    readlineClosedCount: () => readlineClosed,
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
  projectRoot: undefined,
  open: false,
  host: "localhost",
  hostExplicit: false,
  port: 6789,
};

describe("dashboard: port validation", () => {
  it("rejects a non-positive port before starting any server", async () => {
    const { host, startServerSpy } = createFakeHost();
    const output = createFakeOutput();
    await expect(
      runAggregatedDashboardCommand(
        { ...baseDashboardOptions, projectRoot: tmp, port: -1 },
        fakeRuntime(),
        host,
        output,
      ),
    ).rejects.toBeInstanceOf(UsageError);
    expect(startServerSpy).not.toHaveBeenCalled();
  });
});

describe("dashboard: lifecycle", () => {
  it("starts a server, shows the ready banner, and shuts down gracefully on an external shutdown signal", async () => {
    const { host, triggerShutdown, closeSpies } = createFakeHost();
    const output = createFakeOutput();
    triggerShutdown();
    await runAggregatedDashboardCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      output,
    );
    expect(output.ready).toHaveBeenCalledTimes(1);
    expect(closeSpies).toHaveLength(1);
    expect(closeSpies[0]).toHaveBeenCalledTimes(1);
  });

  it("prints the elided default port (80), not :0, when the listener binds http's default port", async () => {
    // `new URL("http://localhost/").port` is "", so `Number(port)` would put
    // `http://localhost:0/` -- a dead link -- in front of the user as the dashboard's
    // entry point. `--port 80` is the invocation that produces exactly this URL.
    const { host, triggerShutdown } = createFakeHost({ serverUrl: "http://localhost/" });
    const output = createFakeOutput();
    triggerShutdown();
    await runAggregatedDashboardCommand(
      { ...baseDashboardOptions, projectRoot: tmp, port: 80 },
      fakeRuntime(),
      host,
      output,
    );
    expect(output.ready).toHaveBeenCalledWith(
      expect.objectContaining({ localUrls: ["http://localhost:80/"] }),
    );
  });

  it("does not attach a readline listener when the host is not a TTY (CI/non-interactive)", async () => {
    const { host, triggerShutdown, createReadlineSpy } = createFakeHost({ isTTY: false });
    triggerShutdown();
    await runAggregatedDashboardCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      createFakeOutput(),
    );
    expect(createReadlineSpy).not.toHaveBeenCalled();
  });

  it("swallows a browser-open failure instead of crashing the dashboard (documented improvement)", async () => {
    const { host, triggerShutdown } = createFakeHost({
      isTTY: false,
      openBrowser: () => Promise.reject(new Error("no display available")),
    });
    triggerShutdown();
    await expect(
      runAggregatedDashboardCommand(
        { ...baseDashboardOptions, projectRoot: tmp, open: true },
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
    const done = runAggregatedDashboardCommand(
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
    const done = runAggregatedDashboardCommand(
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

  it("closes the readline listener on shutdown (no leaked listener)", async () => {
    const { host, triggerShutdown, readlineClosedCount } = createFakeHost({ isTTY: true });
    triggerShutdown();
    await runAggregatedDashboardCommand(
      { ...baseDashboardOptions, projectRoot: tmp },
      fakeRuntime(),
      host,
      createFakeOutput(),
    );
    expect(readlineClosedCount()).toBe(1);
  });

  it("'h' lists all shortcuts (not itself one of them) without ending the command", async () => {
    const { host, emitLine, triggerShutdown } = createFakeHost({ isTTY: true });
    const output = createFakeOutput();
    const done = runAggregatedDashboardCommand(
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

function writeMinimalArtifact(): string {
  const id = "contract-1";
  const contract: VerificationContract = {
    id,
    name: id,
    baseline: { kind: "figma", fileKey: "file-key", nodeId: "153:5181" },
    viewport: { preset: "desktop", width: 1440, height: 1024 },
    outDir: `.framelia/visual-verifications/${id}`,
    scope: { kind: "page", pageReason: "full page baseline" },
  };
  const artifact: VerificationArtifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: "framelia.visual-verification",
    createdAt: new Date().toISOString(),
    projectRoot: tmp,
    request: {
      schemaVersion: SCHEMA_VERSION,
      target: { kind: "web", url: "http://localhost:3000/" },
      contracts: [contract],
    },
    ok: true,
    allPassed: true,
    results: [{ id, ok: true, pass: true, outDir: contract.outDir }],
  };
  const artifactPath = path.join(tmp, "open-artifact.json");
  fs.writeFileSync(artifactPath, JSON.stringify(artifact));
  return artifactPath;
}

describe("dashboard: open", () => {
  it("reads the artifact, derives the suite name from its directory, and serves it", async () => {
    const artifactPath = writeMinimalArtifact();
    const { host, triggerShutdown } = createFakeHost();
    const output = createFakeOutput();
    triggerShutdown();
    await openCommand(
      { artifact: artifactPath, open: false, host: "localhost", hostExplicit: false, port: 6789 },
      fakeRuntime(),
      host,
      output,
    );
    expect(output.ready).toHaveBeenCalledTimes(1);
  });

  it("resolves a relative artifact path against the injected runtime cwd, not global process.cwd()", async () => {
    writeMinimalArtifact();
    const runtime = { ...fakeRuntime(), cwd: () => tmp };
    const { host, triggerShutdown } = createFakeHost();
    triggerShutdown();
    await expect(
      openCommand(
        {
          artifact: "open-artifact.json",
          open: false,
          host: "localhost",
          hostExplicit: false,
          port: 6789,
        },
        runtime,
        host,
        createFakeOutput(),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects a non-positive port before reading the artifact", async () => {
    const { host, startServerSpy } = createFakeHost();
    await expect(
      openCommand(
        {
          artifact: "irrelevant.json",
          open: false,
          host: "localhost",
          hostExplicit: false,
          port: 0,
        },
        fakeRuntime(),
        host,
        createFakeOutput(),
      ),
    ).rejects.toBeInstanceOf(UsageError);
    expect(startServerSpy).not.toHaveBeenCalled();
  });
});
