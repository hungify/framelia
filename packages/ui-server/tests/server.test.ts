import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { UIEvent, UIRun } from "@framelia/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { startUIServer, type UISource } from "../src/server.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

async function clientFixture(): Promise<string> {
  const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framelia-ui-server-client-"));
  temporaryDirectories.push(clientRoot);
  await fs.writeFile(path.join(clientRoot, "index.html"), "<main>Framelia</main>");
  return clientRoot;
}

const emptyRun: UIRun = {
  schemaVersion: 1,
  runId: "run-1",
  status: "passed",
  summary: { total: 0, queued: 0, running: 0, passed: 0, "masked-pass": 0, failed: 0, blocked: 0 },
  contracts: [],
  startedAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
};

describe("startUIServer", () => {
  it("serves /api/run, honors clientRoot, and reports live:false without subscribe", async () => {
    const clientRoot = await clientFixture();
    const source: UISource = { snapshot: () => emptyRun, files: () => new Map() };
    const server = await startUIServer({ source, clientRoot });
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
    const listeners = new Set<(event: UIEvent) => void>();
    const source: UISource = {
      snapshot: () => emptyRun,
      files: () => new Map(),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const server = await startUIServer({ source, clientRoot });
    try {
      expect(await (await fetch(`${server.url}/api/meta`)).json()).toEqual({ live: true });
      const response = await fetch(`${server.url}/events`);
      expect(response.status).toBe(200);
      await response.body?.cancel();
    } finally {
      await server.close();
    }
  });

  it("only serves allowlisted artifact files, rejecting unknown paths", async () => {
    const clientRoot = await clientFixture();
    const evidenceDir = await fs.mkdtemp(path.join(os.tmpdir(), "framelia-ui-server-evidence-"));
    temporaryDirectories.push(evidenceDir);
    const actualPath = path.join(evidenceDir, "actual.png");
    await fs.writeFile(actualPath, Buffer.from([1, 2, 3]));
    const source: UISource = {
      snapshot: () => emptyRun,
      files: () => new Map([["contracts/home/actual.png", actualPath]]),
    };
    const server = await startUIServer({ source, clientRoot });
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
    const clientRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framelia-ui-server-empty-"));
    temporaryDirectories.push(clientRoot);
    const source: UISource = { snapshot: () => emptyRun, files: () => new Map() };
    await expect(startUIServer({ source, clientRoot })).rejects.toThrow(/UI build missing/);
  });
});
