import { describe, expect, it } from "vitest";

import { waitForDashboardShutdown, type ShutdownSignalSource } from "../src/shutdown.ts";

type Signal = "SIGINT" | "SIGTERM";

/** A two-method fake -- never sends a real OS signal into the shared vitest worker process. */
function fakeSignalSource(): {
  source: ShutdownSignalSource;
  emit: (signal: Signal) => void;
  listenerCount: (signal: Signal) => number;
} {
  const listeners = new Map<Signal, Set<() => void>>();
  const source: ShutdownSignalSource = {
    once: (signal, listener) => {
      (listeners.get(signal) ?? listeners.set(signal, new Set()).get(signal)!).add(listener);
    },
    off: (signal, listener) => {
      listeners.get(signal)?.delete(listener);
    },
  };
  return {
    source,
    emit: (signal) => {
      for (const listener of listeners.get(signal) ?? []) listener();
    },
    listenerCount: (signal) => listeners.get(signal)?.size ?? 0,
  };
}

describe("waitForDashboardShutdown", () => {
  it("registers a listener for both signals before resolving", () => {
    const fake = fakeSignalSource();
    void waitForDashboardShutdown(fake.source);
    expect(fake.listenerCount("SIGINT")).toBe(1);
    expect(fake.listenerCount("SIGTERM")).toBe(1);
  });

  it("resolves when SIGINT fires and removes the SIGTERM listener too", async () => {
    const fake = fakeSignalSource();
    const promise = waitForDashboardShutdown(fake.source);
    fake.emit("SIGINT");
    await expect(promise).resolves.toBeUndefined();
    expect(fake.listenerCount("SIGINT")).toBe(0);
    expect(fake.listenerCount("SIGTERM")).toBe(0);
  });

  it("resolves when SIGTERM fires and removes the SIGINT listener too", async () => {
    const fake = fakeSignalSource();
    const promise = waitForDashboardShutdown(fake.source);
    fake.emit("SIGTERM");
    await expect(promise).resolves.toBeUndefined();
    expect(fake.listenerCount("SIGINT")).toBe(0);
    expect(fake.listenerCount("SIGTERM")).toBe(0);
  });

  it("only resolves once even if both signals fire", async () => {
    const fake = fakeSignalSource();
    const promise = waitForDashboardShutdown(fake.source);
    fake.emit("SIGINT");
    fake.emit("SIGTERM");
    await expect(promise).resolves.toBeUndefined();
  });
});
