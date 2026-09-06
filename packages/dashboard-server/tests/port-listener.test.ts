import * as net from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listenWithPortRetry } from "../src/port-listener.ts";

// EADDRINUSE is a genuine OS-level condition -- it can't be faked without
// losing the thing under test, so these bind a real socket to occupy a
// real port before each test and release it afterward.
let blocker: net.Server;
let blockedPort: number;

beforeEach(async () => {
  blocker = net.createServer();
  blockedPort = await new Promise<number>((resolve, reject) => {
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
});

afterEach(async () => {
  await new Promise<void>((resolve) => blocker.close(() => resolve()));
});

function serverPort(server: { address: () => net.AddressInfo | string | null }): number {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Expected an AddressInfo.");
  return address.port;
}

describe("listenWithPortRetry", () => {
  it("retries the next port on a real EADDRINUSE and reports it via onPortInUse", async () => {
    const events: Array<[number, number]> = [];
    const server = await listenWithPortRetry({
      fetch: () => new Response("ok"),
      hostname: "localhost",
      startPort: blockedPort,
      onPortInUse: (port, nextPort) => events.push([port, nextPort]),
    });
    try {
      expect(serverPort(server)).toBe(blockedPort + 1);
      expect(events).toEqual([[blockedPort, blockedPort + 1]]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("throws EADDRINUSE once maxAttempts is exhausted, without retrying further", async () => {
    const events: Array<[number, number]> = [];
    await expect(
      listenWithPortRetry({
        fetch: () => new Response("ok"),
        hostname: "localhost",
        startPort: blockedPort,
        maxAttempts: 1,
        onPortInUse: (port, nextPort) => events.push([port, nextPort]),
      }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(events).toEqual([]);
  });

  it("succeeds immediately when the starting port is free", async () => {
    const server = await listenWithPortRetry({
      fetch: () => new Response("ok"),
      hostname: "localhost",
      startPort: blockedPort + 1,
    });
    try {
      expect(serverPort(server)).toBe(blockedPort + 1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
