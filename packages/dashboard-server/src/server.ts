import { fileURLToPath } from "node:url";

import type { DashboardEvent, DashboardRun } from "@framelia/contracts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { listenWithPortRetry } from "./port-listener.ts";
import { assertClientBuildExists, mountArtifactRoute, mountClientRoutes } from "./static-assets.ts";

export interface DashboardSource {
  snapshot: () => DashboardRun | Promise<DashboardRun>;
  files: () => Map<string, string> | Promise<Map<string, string>>;
  subscribe?: (listener: (event: DashboardEvent) => void) => () => void;
}

export interface DashboardServer {
  url: string;
  close: () => Promise<void>;
}

export const DEFAULT_DASHBOARD_PORT = 6789;

/**
 * Where the bundled Vue dashboard client lives by default. Both the CLI's
 * `open`/`report`/`dashboard` commands and `@framelia/playwright`'s Reporter
 * depend on `@framelia/dashboard-server`, so this is the one place both
 * consumers can reach the built UI without either depending on the other
 * -- `apps/dashboard`'s vite build outputs directly here.
 */
export function defaultClientRoot(): string {
  return fileURLToPath(new URL("../dist/dashboard", import.meta.url));
}

/**
 * Wires up the dashboard's routes and binds a real HTTP listener. Static-file
 * serving lives in static-assets.ts, the EADDRINUSE port-retry loop in
 * port-listener.ts, and shutdown-signal handling in shutdown.ts (see
 * `waitForDashboardShutdown`, exported alongside this from index.ts) — every
 * route here is thin wiring onto those modules and `options.source`, except
 * `/events`, whose SSE fan-out (ordered writes, heartbeat, subscriber
 * cleanup) is route-specific enough that it doesn't fit any of the three
 * extracted modules and stays inline.
 */
export async function startDashboardServer(options: {
  source: DashboardSource;
  hostname?: string;
  port?: number;
  clientRoot?: string;
}): Promise<DashboardServer> {
  const hostname = options.hostname ?? "localhost";
  const clientRoot = options.clientRoot ?? defaultClientRoot();
  await assertClientBuildExists(clientRoot);
  const app = new Hono();

  app.get("/api/run", async (context) =>
    context.json(await options.source.snapshot(), 200, { "cache-control": "no-store" }),
  );
  app.get("/api/meta", (context) =>
    context.json({ live: Boolean(options.source.subscribe) }, 200, { "cache-control": "no-store" }),
  );
  app.get("/api/contracts", async (context) => {
    const id = context.req.query("id");
    const result = (await options.source.snapshot()).contracts.find(
      (contract) => contract.id === id,
    );
    return result ? context.json(result) : context.json({ error: "Contract not found" }, 404);
  });
  mountArtifactRoute(app, options.source.files);
  app.get("/events", (context) => {
    const subscribe = options.source.subscribe;
    if (!subscribe)
      return context.json({ error: "Live events unavailable for archived run." }, 404);
    return streamSSE(context, async (stream) => {
      // Writes must land in order even though they're triggered from independent
      // sources (subscriber events, the initial sync frame, the heartbeat timer).
      // One owner for "queue a write, and don't let one failure break the stream."
      let chain = Promise.resolve();
      const enqueue = (write: () => Promise<void>): void => {
        chain = chain.then(write).catch(() => undefined);
      };

      const unsubscribe = subscribe((event) => {
        enqueue(() =>
          stream.writeSSE({
            id: String(event.sequence),
            event: "run",
            data: JSON.stringify(event),
          }),
        );
      });

      enqueue(async () => {
        const snapshot = await options.source.snapshot();
        await stream.writeSSE({
          id: "sync",
          event: "run",
          data: JSON.stringify({
            sequence: 0,
            runId: snapshot.runId,
            status: snapshot.status,
            timestamp: snapshot.updatedAt,
          } satisfies DashboardEvent),
        });
      });

      const heartbeat = setInterval(() => {
        enqueue(() => stream.writeSSE({ event: "heartbeat", data: "{}" }));
      }, 15_000);

      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
      });
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    });
  });
  mountClientRoutes(app, clientRoot);

  const server = await listenWithPortRetry({
    fetch: app.fetch,
    hostname,
    startPort: options.port ?? DEFAULT_DASHBOARD_PORT,
    onPortInUse: (port, nextPort) => console.error(`Port ${port} is in use, trying ${nextPort}...`),
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not resolve dashboard server address.");
  return {
    url: `http://${hostname}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
