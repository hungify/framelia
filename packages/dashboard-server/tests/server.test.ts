import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

import type { DashboardEvent, DashboardRun } from "@framelia/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { startDashboardServer, type DashboardSource } from "../src/server.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function clientFixture(): Promise<string> {
  const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framelia-dashboard-server-client-"));
  temporaryDirectories.push(clientRoot);
  await fs.writeFile(path.join(clientRoot, "index.html"), "<main>Framelia</main>");
  return clientRoot;
}

const emptyRun: DashboardRun = {
  schemaVersion: 1,
  runId: "run-1",
  status: "passed",
  summary: { total: 0, queued: 0, running: 0, passed: 0, "masked-pass": 0, failed: 0, blocked: 0 },
  contracts: [],
  startedAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

describe("startDashboardServer", () => {
  it("serves /api/run, honors clientRoot, and reports live:false without subscribe", async () => {
    const clientRoot = await clientFixture();
    const source: DashboardSource = { snapshot: () => emptyRun, files: () => new Map() };
    const server = await startDashboardServer({ source, clientRoot });
    try {
      expect(await (await fetch(`${server.url}/api/run`)).json()).toMatchObject({ runId: "run-1" });
      expect(await (await fetch(`${server.url}/api/meta`)).json()).toEqual({ live: false });
      expect(await (await fetch(`${server.url}/`)).text()).toContain("Framelia");
      expect((await fetch(`${server.url}/events`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("reports live:true and streams SSE when the source is subscribable", async () => {
    const clientRoot = await clientFixture();
    const listeners = new Set<(event: DashboardEvent) => void>();
    const source: DashboardSource = {
      snapshot: () => emptyRun,
      files: () => new Map(),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const server = await startDashboardServer({ source, clientRoot });
    try {
      expect(await (await fetch(`${server.url}/api/meta`)).json()).toEqual({ live: true });
      const response = await fetch(`${server.url}/events`);
      expect(response.status).toBe(200);
      await response.body?.cancel();
    } finally {
      await server.close();
    }
  });

  it("closes while an SSE client is still connected, instead of waiting for it to disconnect", async () => {
    // A real dashboard tab holds `/events` open for the whole session, and Node's
    // `server.close()` waits for every active connection. Restart ("r"), quit ("q"),
    // and SIGTERM shutdown all go through this close, so a still-connected client
    // must not be able to hold any of them open. The awaited signal is the close
    // promise itself; the per-test timeout below (well under the suite's 60s default)
    // is only what turns a regression into a fast failure instead of a stalled run.
    const clientRoot = await clientFixture();
    let unsubscribed = false;
    const source: DashboardSource = {
      snapshot: () => emptyRun,
      files: () => new Map(),
      subscribe: () => () => {
        unsubscribed = true;
      },
    };
    const server = await startDashboardServer({ source, clientRoot });
    const streamAbort = new AbortController();
    const response = await fetch(`${server.url}/events`, { signal: streamAbort.signal });
    expect(response.status).toBe(200);
    try {
      // The stream stays deliberately open (no body cancel) across the close.
      await expect(server.close()).resolves.toBeUndefined();
      // Dropping the socket must run the route's onAbort cleanup -- otherwise the
      // 15s heartbeat interval outlives the server and keeps the process alive.
      await vi.waitFor(() => expect(unsubscribed).toBe(true));
    } finally {
      streamAbort.abort();
    }
  }, 5_000);

  it("only serves allowlisted artifact files, rejecting unknown paths", async () => {
    const clientRoot = await clientFixture();
    const evidenceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "framelia-dashboard-server-evidence-"),
    );
    temporaryDirectories.push(evidenceDir);
    const actualPath = path.join(evidenceDir, "actual.png");
    await fs.writeFile(actualPath, Buffer.from([1, 2, 3]));
    const source: DashboardSource = {
      snapshot: () => emptyRun,
      files: () => new Map([["contracts/home/actual.png", actualPath]]),
    };
    const server = await startDashboardServer({ source, clientRoot });
    try {
      const allowed = await fetch(`${server.url}/artifacts/contracts/home/actual.png`);
      expect(allowed.status).toBe(200);
      const rejected = await fetch(`${server.url}/artifacts/not-allowlisted.png`);
      expect(rejected.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("rejects when clientRoot has no index.html", async () => {
    const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framelia-dashboard-server-empty-"));
    temporaryDirectories.push(clientRoot);
    const source: DashboardSource = { snapshot: () => emptyRun, files: () => new Map() };
    await expect(startDashboardServer({ source, clientRoot })).rejects.toThrow(
      /Dashboard build missing/,
    );
  });

  it("end-to-end: retries onto the next port on a real EADDRINUSE, reachable through the public API", async () => {
    // A genuine OS-level EADDRINUSE, driven entirely through startDashboardServer's
    // public options (not by reaching into port-listener.ts directly) -- this is the
    // one test that proves shutdown.ts/port-listener.ts/static-assets.ts actually
    // recombine into a working server, not just that each extracted piece works
    // in isolation.
    const clientRoot = await clientFixture();
    const blocker = net.createServer();
    const blockedPort = await new Promise<number>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "localhost", () => {
        const address = blocker.address();
        if (address === null || typeof address === "string") {
          reject(new Error("Expected an AddressInfo from a listening TCP server."));
          return;
        }
        resolve(address.port);
      });
    });
    try {
      const source: DashboardSource = { snapshot: () => emptyRun, files: () => new Map() };
      const server = await startDashboardServer({ source, clientRoot, port: blockedPort });
      try {
        expect(server.url).toBe(`http://localhost:${blockedPort + 1}`);
        expect(await (await fetch(`${server.url}/api/run`)).json()).toMatchObject({
          runId: "run-1",
        });
      } finally {
        await server.close();
      }
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
