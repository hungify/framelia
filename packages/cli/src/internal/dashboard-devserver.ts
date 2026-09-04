import * as path from "node:path";

import type { DashboardSource } from "@framelia/dashboard-server";
import { z } from "zod";

import type { DashboardHost } from "../dashboard-types.ts";
import {
  aggregateDashboardSource,
  archivedDashboardSource,
  readVerificationArtifact,
} from "../dashboard/report.ts";
import { usageErrorFromZodError } from "../errors.ts";
import type { CliRuntime } from "../runtime-types.ts";
import {
  createDashboardOutput,
  type DashboardOutput,
  type NetworkUrl,
} from "./dashboard-output.ts";
import { productionDashboardHost } from "./dashboard-runtime.ts";
import { resolveProjectRoot } from "./project-root.ts";

const portSchema = z.object({ port: z.number().int().positive().max(65_535) });

function requirePositivePort(port: number): void {
  const parsed = portSchema.safeParse({ port });
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);
}

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "0000:0000:0000:0000:0000:0000:0000:0000"]);
const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0000:0000:0000:0000:0000:0000:0000:0001",
]);

interface ServerUrls {
  readonly local: readonly string[];
  readonly network: readonly NetworkUrl[];
}

function bracketIfIPv6(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/** Which URLs the ready banner should show for `hostname` -- derives everything from
 * the injected `DashboardHost`'s DNS/network-interface lookups, never `node:dns`/
 * `node:os` directly, so this is testable with a fake host. */
async function resolveServerUrls(
  hostname: string,
  port: number,
  host: DashboardHost,
): Promise<ServerUrls> {
  const local: string[] = [];
  const network: NetworkUrl[] = [];
  if (!WILDCARD_HOSTS.has(hostname)) {
    const displayHost =
      hostname === "localhost" ? ((await host.lookupLocalhost()) ?? hostname) : hostname;
    const url = `http://${bracketIfIPv6(displayHost)}:${port}/`;
    if (LOOPBACK_HOSTS.has(hostname)) {
      local.push(url);
    } else {
      let interfaceName: string | undefined;
      outer: for (const [name, details] of Object.entries(host.networkInterfaces())) {
        for (const detail of details ?? []) {
          if (detail.address === hostname) {
            interfaceName = name;
            break outer;
          }
        }
      }
      network.push({ url, interfaceName });
    }
  } else {
    for (const [name, details] of Object.entries(host.networkInterfaces())) {
      for (const detail of details ?? []) {
        if (!detail.address || detail.family !== "IPv4") continue;
        const url = `http://${detail.address.replace("127.0.0.1", "localhost")}:${port}/`;
        if (detail.address === "127.0.0.1") local.push(url);
        else network.push({ url, interfaceName: name });
      }
    }
  }
  return { local, network };
}

const SERVER_CLOSE_TIMEOUT_MS = 5_000;

/** The port `URL` elides from an `http:` URL (see `serveDashboard`'s banner). */
const HTTP_DEFAULT_PORT = 80;

/**
 * Bounds `server.close()`. @framelia/dashboard-server now drops live sockets on close
 * (its `/events` SSE streams would otherwise keep an HTTP server's close pending until
 * every dashboard tab disconnects), so this is a backstop against a host whose close
 * still never settles -- the loop must not wait on it forever. The timer is cleared
 * once the race settles: a pending `setTimeout` keeps the event loop alive, which
 * would delay every `q`/SIGTERM exit by the full bound after a close that already
 * finished.
 */
async function closeWithTimeout(server: { close: () => Promise<void> }): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      server.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SERVER_CLOSE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

interface Shortcut {
  readonly key: string;
  readonly description: string;
  readonly action: () => void | Promise<void>;
}

function buildShortcuts(
  host: DashboardHost,
  output: DashboardOutput,
  server: { url: string; close: () => Promise<void> },
  onRestart: () => void,
  onQuit: () => void,
): Shortcut[] {
  return [
    {
      key: "r",
      description: "restart the server",
      action: () => {
        output.restarting();
        onRestart();
      },
    },
    { key: "u", description: "show server url", action: () => output.localUrl(server.url) },
    {
      key: "o",
      description: "open in browser",
      action: () => host.openBrowser(server.url).catch(() => undefined),
    },
    { key: "c", description: "clear console", action: () => output.clear() },
    { key: "q", description: "quit", action: () => onQuit() },
  ];
}

/** No listener when `host.isTTY()` is false (folds in the old CLI's `!isTTY || CI` gate
 * -- see `dashboard-runtime.ts`), matching today's CI/non-interactive behavior exactly. */
function listenForShortcuts(
  host: DashboardHost,
  output: DashboardOutput,
  shortcuts: readonly Shortcut[],
): () => void {
  if (!host.isTTY()) return () => undefined;
  output.shortcutHint();
  const rl = host.createReadline();
  let actionRunning = false;
  rl.on("line", (line) => {
    if (actionRunning) return;
    const input = line.trim().toLowerCase();
    if (input === "h") {
      output.shortcuts(shortcuts.map(({ key, description }) => ({ key, description })));
      return;
    }
    const shortcut = shortcuts.find((candidate) => candidate.key === input);
    if (!shortcut) return;
    actionRunning = true;
    void Promise.resolve(shortcut.action()).finally(() => {
      actionRunning = false;
    });
  });
  return () => rl.close();
}

/**
 * The restart loop: each iteration starts a server, shows its ready banner, then waits
 * for the next signal -- an external shutdown, an "r" restart, or a "q" quit -- and
 * closes the server before either looping (restart) or returning (shutdown/quit).
 *
 * The old CLI's "q" shortcut called `server.close()` then `process.exit()` directly.
 * That call is gone (Architecture §5: no `internal/*.ts` module calls global
 * `process.exit()`): quit now resolves a `quitSignal` deferred, the same shape as
 * restart's, so this loop's own `finally` closes the server exactly once and the
 * function returns normally -- Stricli finishes the command with its default success
 * exit code, which is what a graceful quit means.
 */
async function serveDashboard(
  source: DashboardSource,
  open: boolean,
  hostname: string,
  hostExplicit: boolean,
  port: number,
  host: DashboardHost,
  output: DashboardOutput,
): Promise<void> {
  const shutdown = host.waitForShutdown();
  let shouldOpen = open;
  // A restart loop, not a batch of independent work: each iteration must start its
  // server, show its banner, wait for the next signal, and close before the next
  // iteration can begin -- there is nothing here that could run concurrently.
  for (;;) {
    const startedAt = host.now();
    // eslint-disable-next-line no-await-in-loop -- must finish starting before this iteration can proceed
    const server = await host.startServer({ source, hostname, port });
    let restart = false;
    try {
      const elapsedMs = Math.round(host.now() - startedAt);
      // `URL.port` is "" whenever the listener bound its scheme's default port --
      // `--port 80` normalizes `server.url` to `http://localhost/` -- and `Number("")`
      // is 0, which would print `http://localhost:0/` as the user's entry point.
      // @framelia/dashboard-server always serves plain HTTP, so an elided port is 80.
      const serverUrl = new URL(server.url);
      const listeningPort = serverUrl.port === "" ? HTTP_DEFAULT_PORT : Number(serverUrl.port);
      // eslint-disable-next-line no-await-in-loop -- banner describes this iteration's server, not the next
      const urls = await resolveServerUrls(hostname, listeningPort, host);
      output.ready({ elapsedMs, localUrls: urls.local, networkUrls: urls.network, hostExplicit });
      const restartSignal = createDeferred<void>();
      const quitSignal = createDeferred<void>();
      const stopListening = listenForShortcuts(
        host,
        output,
        buildShortcuts(
          host,
          output,
          server,
          () => {
            restart = true;
            restartSignal.resolve();
          },
          () => quitSignal.resolve(),
        ),
      );
      try {
        // Old CLI let a browser-open failure crash the whole dashboard command (no
        // try/catch around it). Swallowing it here -- the dashboard stays usable via
        // the printed URL even when a browser can't be launched -- is a documented,
        // intentional improvement called for by the rewrite plan's Phase 9
        // acceptance-contract line on "browser-open failures", not an oversight.
        // eslint-disable-next-line no-await-in-loop -- opens this iteration's own server.url once
        if (shouldOpen) await host.openBrowser(server.url).catch(() => undefined);
        shouldOpen = false;
        // eslint-disable-next-line no-await-in-loop -- this IS the loop's wait, not incidental work to batch
        await Promise.race([shutdown, restartSignal.promise, quitSignal.promise]);
      } finally {
        stopListening();
      }
    } finally {
      // eslint-disable-next-line no-await-in-loop -- must close before a restart starts the next server
      await closeWithTimeout(server);
    }
    if (!restart) return;
  }
}

export interface RunDashboardOptions {
  readonly projectRoot: string | undefined;
  readonly open: boolean;
  readonly host: string;
  readonly hostExplicit: boolean;
  readonly port: number;
}

export async function runAggregatedDashboardCommand(
  options: RunDashboardOptions,
  runtime: CliRuntime,
  host: DashboardHost = productionDashboardHost,
  output: DashboardOutput = createDashboardOutput(runtime),
): Promise<void> {
  requirePositivePort(options.port);
  const projectRoot = resolveProjectRoot(options.projectRoot, runtime);
  const source = await aggregateDashboardSource(projectRoot);
  await serveDashboard(
    source,
    options.open,
    options.host,
    options.hostExplicit,
    options.port,
    host,
    output,
  );
}

export interface OpenDashboardOptions {
  readonly artifact: string;
  readonly open: boolean;
  readonly host: string;
  readonly hostExplicit: boolean;
  readonly port: number;
}

export async function openCommand(
  options: OpenDashboardOptions,
  runtime: CliRuntime,
  host: DashboardHost = productionDashboardHost,
  output: DashboardOutput = createDashboardOutput(runtime),
): Promise<void> {
  requirePositivePort(options.port);
  const artifactPath = path.resolve(runtime.cwd(), options.artifact);
  const artifact = await readVerificationArtifact(artifactPath);
  const suiteName = path.basename(path.dirname(artifactPath));
  const source = await archivedDashboardSource(artifact, suiteName);
  await serveDashboard(
    source,
    options.open,
    options.host,
    options.hostExplicit,
    options.port,
    host,
    output,
  );
}
