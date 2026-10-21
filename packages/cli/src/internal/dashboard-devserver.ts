import type { DashboardSource } from "@framelia/dashboard-server";
import {
  DEFAULT_DASHBOARD_HOSTNAME,
  WILDCARD_DASHBOARD_HOSTNAME,
} from "@framelia/dashboard-server/constants";
import { z } from "zod";

import { selectedDashboardSource } from "../dashboard/report.ts";
import { resolveDashboardUrls, type NetworkUrl } from "../dashboard/urls.ts";
import type { CommandEnvironment } from "../environment.ts";
import { JSON_INDENT_SPACES, UsageError, usageErrorFromZodError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { createDashboardOutput, type DashboardOutput } from "./dashboard-output.ts";
import type { DashboardHost } from "./dashboard-runtime.ts";
import { failureOutcome } from "./outcome.ts";
import { openProject } from "./project.ts";
import { readRunProjection } from "./run-projection.ts";

const portSchema = z.object({ port: z.number().int().positive().max(65_535) });
const SERVER_CLOSE_TIMEOUT_MS = 5_000;

interface DashboardServerFlags {
  readonly host: string | undefined;
  readonly port: number;
  readonly noOpen: boolean;
}
export interface DashboardOptions extends DashboardServerFlags {
  readonly projectRoot: string | undefined;
  /** Parser-optional so a missing run is one structured outcome, not Stricli stderr. */
  readonly run: string | undefined;
}

export interface OpenDashboardOptions extends DashboardOptions {}

export interface DashboardDevserverOptions extends DashboardOptions {
  readonly command?: "open" | "dashboard";
}

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
  if (host === undefined) return { hostname: DEFAULT_DASHBOARD_HOSTNAME, explicit: false };
  return { hostname: host === "" ? WILDCARD_DASHBOARD_HOSTNAME : host, explicit: true };
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

/** Shortcuts need a person at a terminal: a TTY stdin outside CI. */
function interactiveInput(runtime: CliRuntime): boolean {
  return "isTTY" in runtime.stdin && runtime.stdin.isTTY === true && !runtime.env.CI;
}

function listenForShortcuts(
  host: DashboardHost,
  runtime: CliRuntime,
  output: DashboardOutput,
  shortcuts: readonly Shortcut[],
): () => void {
  if (!interactiveInput(runtime)) return () => undefined;
  let actionRunning = false;
  const stop = host.listenForInput(runtime.stdin, (line) => {
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
  output.shortcutHint();
  return stop;
}

async function serveDashboard(
  source: DashboardSource,
  options: DashboardServerFlags,
  env: Pick<CommandEnvironment, "process" | "signals">,
  host: DashboardHost,
  output: DashboardOutput,
  onReady: (address: {
    browser: string;
    local: readonly string[];
    network: readonly NetworkUrl[];
  }) => void,
): Promise<void> {
  const { hostname, explicit } = resolveHost(options.host);
  const shutdown = host.waitForShutdown(env.signals);
  // CI has nobody to look at a browser, and opening one there can hang the job.
  let shouldOpen = !options.noOpen && !env.process.env.CI;
  let readinessEmitted = false;
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
      if (!readinessEmitted) {
        readinessEmitted = true;
        onReady({ browser: urls.browser, local: urls.local, network: urls.network });
      }
      const restartSignal = createDeferred<void>();
      const quitSignal = createDeferred<void>();
      const stopListening = listenForShortcuts(
        host,
        env.process,
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

/**
 * Serves one selected run until shutdown. Once listening it writes exactly one
 * `framelia.open-ready` record to stdout; a failure before that (missing run, invalid
 * port, port in use) writes one `framelia.open-outcome` error record instead and exits 2.
 */
export async function dashboardDevserverCommand(
  options: DashboardDevserverOptions,
  env: CommandEnvironment,
  seams: { readonly output?: DashboardOutput } = {},
): Promise<void> {
  const runtime = env.process;
  const command = options.command ?? "dashboard";
  let ready = false;
  try {
    requirePositivePort(options.port);
    if (!options.run) {
      throw new UsageError(`${command} requires --run <id>; list durable runs to choose one.`, {
        code: "RUN_SELECTION_MISSING",
      });
    }
    const project = openProject(options.projectRoot, runtime);
    const projection = readRunProjection(project.root, options.run);
    const source = selectedDashboardSource(project.root, options.run);
    const host = await env.adapters.dashboard();
    const output = seams.output ?? createDashboardOutput(runtime);
    await serveDashboard(source, options, env, host, output, (address) => {
      ready = true;
      runtime.stdout.write(
        `${JSON.stringify({
          formatVersion: 1,
          kind: "framelia.open-ready",
          command,
          selectedRun: { runId: projection.runId, bundlePath: projection.bundlePath },
          address,
        })}\n`,
      );
    });
  } catch (error) {
    // After readiness the one stdout record is already written; later failures stay on stderr.
    if (ready) throw error;
    const failure = failureOutcome({
      kind: "framelia.open-outcome",
      command,
      error,
      fallbackCode: "DASHBOARD_FAILED",
      stage: command,
      projectRoot: options.projectRoot,
    });
    runtime.stdout.write(`${JSON.stringify(failure.body, null, JSON_INDENT_SPACES)}\n`);
    runtime.exitCode = failure.exitCode;
  }
}
