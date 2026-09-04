import * as path from "node:path";

import type { DashboardSource } from "@framelia/dashboard-server";
import { z } from "zod";

import {
  aggregateDashboardSource,
  archivedDashboardSource,
  readVerificationArtifact,
} from "../dashboard/report.ts";
import { resolveDashboardUrls } from "../dashboard/urls.ts";
import { usageErrorFromZodError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { createDashboardOutput, type DashboardOutput } from "./dashboard-output.ts";
import { productionDashboardHost, type DashboardHost } from "./dashboard-runtime.ts";
import { openProject } from "./project.ts";

const portSchema = z.object({ port: z.number().int().positive().max(65_535) });
const SERVER_CLOSE_TIMEOUT_MS = 5_000;

interface DashboardServerFlags {
  readonly host: string | undefined;
  readonly port: number;
  readonly noOpen: boolean;
}

export interface DashboardOptions extends DashboardServerFlags {
  readonly projectRoot: string | undefined;
}

export interface OpenDashboardOptions extends DashboardServerFlags {
  readonly artifact: string;
}

export type DashboardDevserverOptions = DashboardOptions | OpenDashboardOptions;

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

interface Shortcut {
  readonly key: string;
  readonly description: string;
  readonly action: () => void | Promise<void>;
}

function requirePositivePort(port: number): void {
  const parsed = portSchema.safeParse({ port });
  if (!parsed.success) throw usageErrorFromZodError(parsed.error);
}

function resolveHost(host: string | undefined): { hostname: string; explicit: boolean } {
  if (host === undefined) return { hostname: "localhost", explicit: false };
  return { hostname: host === "" ? "0.0.0.0" : host, explicit: true };
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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

function buildShortcuts(
  host: DashboardHost,
  output: DashboardOutput,
  browserUrl: string,
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
    { key: "u", description: "show server url", action: () => output.localUrl(browserUrl) },
    {
      key: "o",
      description: "open in browser",
      action: () => host.openBrowser(browserUrl).catch(() => undefined),
    },
    { key: "c", description: "clear console", action: () => output.clear() },
    { key: "q", description: "quit", action: () => onQuit() },
  ];
}

function listenForShortcuts(
  host: DashboardHost,
  output: DashboardOutput,
  shortcuts: readonly Shortcut[],
): () => void {
  let actionRunning = false;
  const stop = host.listenForInput((line) => {
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
  if (!stop) return () => undefined;
  output.shortcutHint();
  return stop;
}

async function serveDashboard(
  source: DashboardSource,
  options: DashboardServerFlags,
  host: DashboardHost,
  output: DashboardOutput,
): Promise<void> {
  const { hostname, explicit } = resolveHost(options.host);
  const shutdown = host.waitForShutdown();
  let shouldOpen = !options.noOpen;
  for (;;) {
    const startedAt = host.now();
    // eslint-disable-next-line no-await-in-loop -- must finish starting before this iteration can proceed
    const server = await host.startServer({ source, hostname, port: options.port });
    let restart = false;
    try {
      const elapsedMs = Math.round(host.now() - startedAt);
      // eslint-disable-next-line no-await-in-loop -- banner describes this iteration's server
      const network = await host.networkContext();
      const urls = resolveDashboardUrls({
        hostname: server.hostname,
        port: server.port,
        localhostAlias: network.localhostAlias,
        networkInterfaces: network.networkInterfaces,
      });
      output.ready({
        elapsedMs,
        localUrls: urls.local,
        networkUrls: urls.network,
        hostExplicit: explicit,
      });
      const restartSignal = createDeferred<void>();
      const quitSignal = createDeferred<void>();
      const stopListening = listenForShortcuts(
        host,
        output,
        buildShortcuts(
          host,
          output,
          urls.browser,
          () => {
            restart = true;
            restartSignal.resolve();
          },
          () => quitSignal.resolve(),
        ),
      );
      try {
        // eslint-disable-next-line no-await-in-loop -- opens this iteration's server once
        if (shouldOpen) await host.openBrowser(urls.browser).catch(() => undefined);
        shouldOpen = false;
        // eslint-disable-next-line no-await-in-loop -- this is the loop's wait
        await Promise.race([shutdown, restartSignal.promise, quitSignal.promise]);
      } finally {
        stopListening();
      }
    } finally {
      // eslint-disable-next-line no-await-in-loop -- must close before restarting
      await closeWithTimeout(server);
    }
    if (!restart) return;
  }
}

async function loadDashboardSource(
  options: DashboardDevserverOptions,
  runtime: CliRuntime,
): Promise<DashboardSource> {
  if ("artifact" in options) {
    const artifactPath = path.resolve(runtime.cwd(), options.artifact);
    const artifact = await readVerificationArtifact(artifactPath);
    const suiteName = path.basename(path.dirname(artifactPath));
    return archivedDashboardSource(artifact, suiteName);
  }
  return aggregateDashboardSource(openProject(options.projectRoot, runtime));
}

export async function dashboardDevserverCommand(
  options: DashboardDevserverOptions,
  runtime: CliRuntime,
  host: DashboardHost = productionDashboardHost,
  output: DashboardOutput = createDashboardOutput(runtime),
): Promise<void> {
  requirePositivePort(options.port);
  const source = await loadDashboardSource(options, runtime);
  await serveDashboard(source, options, host, output);
}
