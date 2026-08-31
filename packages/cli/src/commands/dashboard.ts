import { promises as dns } from "node:dns";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

import { FRAMELIA_DIR } from "@framelia/contracts";
import {
  startDashboardServer,
  waitForDashboardShutdown,
  type DashboardServer,
  type DashboardSource,
} from "@framelia/dashboard-server";
import { JSON_INDENT_SPACES } from "@framelia/verify";
import type { Command } from "commander";
import openBrowser from "open";
import pc from "picocolors";

import {
  aggregateDashboardSource,
  archivedDashboardSource,
  exportDashboardReport,
  readVerificationArtifact,
} from "../dashboard/report.ts";
import { resolveProjectRoot, subcommand } from "./shared.ts";

const wildcardHosts = new Set(["0.0.0.0", "::", "0000:0000:0000:0000:0000:0000:0000:0000"]);
const loopbackHosts = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0000:0000:0000:0000:0000:0000:0000:0001",
]);
const maxNetworkInterfaceNameLength = 20;

interface ServerUrls {
  local: string[];
  network: string[];
  networkInterfaceNames: (string | undefined)[];
}

async function localhostAddressIfDiffersFromDns(): Promise<string | undefined> {
  if (dns.getDefaultResultOrder?.() === "verbatim") return undefined;
  const [nodeResult, dnsResult] = await Promise.all([
    dns.lookup("localhost"),
    dns.lookup("localhost", { verbatim: true }),
  ]);
  return nodeResult.family === dnsResult.family && nodeResult.address === dnsResult.address
    ? undefined
    : nodeResult.address;
}

function bracketIfIPv6(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function normalizeHost(raw: string | true): string {
  return raw === true ? "0.0.0.0" : raw;
}

async function resolveServerUrls(hostname: string, port: number): Promise<ServerUrls> {
  const local: string[] = [];
  const network: string[] = [];
  const networkInterfaceNames: (string | undefined)[] = [];
  if (!wildcardHosts.has(hostname)) {
    const displayHost =
      hostname === "localhost"
        ? ((await localhostAddressIfDiffersFromDns()) ?? hostname)
        : hostname;
    const url = `http://${bracketIfIPv6(displayHost)}:${port}/`;
    if (loopbackHosts.has(hostname)) {
      local.push(url);
    } else {
      network.push(url);
      let interfaceName: string | undefined;
      outer: for (const [name, details] of Object.entries(os.networkInterfaces())) {
        for (const detail of details ?? []) {
          if (detail.address === hostname) {
            interfaceName = name;
            break outer;
          }
        }
      }
      networkInterfaceNames.push(interfaceName);
    }
  } else {
    for (const [name, details] of Object.entries(os.networkInterfaces())) {
      for (const detail of details ?? []) {
        if (!detail.address || detail.family !== "IPv4") continue;
        const url = `http://${detail.address.replace("127.0.0.1", "localhost")}:${port}/`;
        if (detail.address === "127.0.0.1") local.push(url);
        else {
          network.push(url);
          networkInterfaceNames.push(name);
        }
      }
    }
  }
  return { local, network, networkInterfaceNames };
}

function colorUrl(url: string): string {
  return pc.cyan(url.replace(/:(\d+)\//, (_match, port: string) => `:${pc.bold(port)}/`));
}

function printLocalUrl(url: string): void {
  console.error(`  ${pc.green("➜")}  ${pc.bold("Local:")}   ${colorUrl(url)}`);
}

function printServerUrls(urls: ServerUrls, hostExplicit: boolean): void {
  for (const url of urls.local) printLocalUrl(url);
  const networkUrlMaxLength = Math.max(0, ...urls.network.map((url) => url.length));
  urls.network.forEach((url, index) => {
    const interfaceName = urls.networkInterfaceNames[index];
    const label =
      interfaceName === undefined
        ? ""
        : interfaceName.length > maxNetworkInterfaceNameLength
          ? `${interfaceName.slice(0, maxNetworkInterfaceNameLength - 1)}…`
          : interfaceName;
    const suffix = label
      ? `${" ".repeat(networkUrlMaxLength - url.length + 2)}${pc.dim(label)}`
      : "";
    console.error(`  ${pc.green("➜")}  ${pc.bold("Network:")} ${colorUrl(url)}${suffix}`);
  });
  if (urls.network.length === 0 && !hostExplicit)
    console.error(
      `${pc.dim(`  ${pc.green("➜")}  ${pc.bold("Network:")} use `)}${pc.bold("--host")}${pc.dim(" to expose")}`,
    );
}

async function printReadyBanner(
  hostname: string,
  url: string,
  elapsedMs: number,
  hostExplicit: boolean,
): Promise<void> {
  console.error(`\n  ${pc.bold(pc.green("FRAMELIA"))} ${pc.dim(`ready in ${elapsedMs}ms`)}\n`);
  printServerUrls(await resolveServerUrls(hostname, Number(new URL(url).port)), hostExplicit);
}

interface Shortcut {
  key: string;
  description: string;
  action: () => void | Promise<void>;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function buildShortcuts(server: DashboardServer, onRestart: () => void): Shortcut[] {
  return [
    {
      key: "r",
      description: "restart the server",
      action: () => {
        console.error(`\n${pc.dim("  restarting server...")}`);
        onRestart();
      },
    },
    { key: "u", description: "show server url", action: () => printLocalUrl(server.url) },
    { key: "o", description: "open in browser", action: () => openBrowser(server.url) },
    { key: "c", description: "clear console", action: () => console.clear() },
    {
      key: "q",
      description: "quit",
      action: async () => {
        await server.close();
        process.exit();
      },
    },
  ];
}

function listenForShortcuts(shortcuts: Shortcut[]): () => void {
  if (!process.stdin.isTTY || process.env.CI) return () => {};
  console.error(
    `${pc.dim(pc.green("  ➜"))}${pc.dim("  press ")}${pc.bold("h + enter")}${pc.dim(" to show help")}`,
  );
  const rl = readline.createInterface({ input: process.stdin });
  let actionRunning = false;
  rl.on("line", (line) => {
    if (actionRunning) return;
    const input = line.trim().toLowerCase();
    if (input === "h") {
      console.error(`\n  ${pc.bold("Shortcuts")}`);
      for (const shortcut of shortcuts) {
        console.error(
          `${pc.dim("  press ")}${pc.bold(`${shortcut.key} + enter`)}${pc.dim(` to ${shortcut.description}`)}`,
        );
      }
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

async function serveDashboard(
  source: DashboardSource,
  open: boolean,
  hostname: string,
  hostExplicit: boolean,
): Promise<void> {
  const shutdown = waitForDashboardShutdown();
  let shouldOpen = open;
  // A restart loop, not a batch of independent work: each iteration must start its
  // server, show its banner, wait for the next signal, and close before the next
  // iteration can begin -- there is nothing here Promise.all could parallelize.
  for (;;) {
    const startedAt = performance.now();
    // eslint-disable-next-line no-await-in-loop -- must finish starting before this iteration can proceed
    const server = await startDashboardServer({ source, hostname });
    let restart = false;
    try {
      // eslint-disable-next-line no-await-in-loop -- banner describes this iteration's server, not the next
      await printReadyBanner(
        hostname,
        server.url,
        Math.round(performance.now() - startedAt),
        hostExplicit,
      );
      const restartSignal = createDeferred<void>();
      const stopListening = listenForShortcuts(
        buildShortcuts(server, () => {
          restart = true;
          restartSignal.resolve();
        }),
      );
      try {
        // eslint-disable-next-line no-await-in-loop -- opens this iteration's own server.url once
        if (shouldOpen) await openBrowser(server.url);
        shouldOpen = false;
        // eslint-disable-next-line no-await-in-loop -- this IS the loop's wait, not incidental work to batch
        await Promise.race([shutdown, restartSignal.promise]);
      } finally {
        stopListening();
      }
    } finally {
      // eslint-disable-next-line no-await-in-loop -- must close before a restart starts the next server
      await server.close();
    }
    if (!restart) return;
  }
}

export async function runAggregatedDashboard(options: {
  projectRoot: string;
  open: boolean;
  host: string;
  hostExplicit: boolean;
}): Promise<void> {
  await serveDashboard(
    await aggregateDashboardSource(options.projectRoot),
    options.open,
    options.host,
    options.hostExplicit,
  );
}

function suiteNameFromArtifactPath(artifactPath: string): string {
  return path.basename(path.dirname(path.resolve(artifactPath)));
}

async function openCommand(
  options: { artifact: string; open: boolean; host: string | true },
  command: Command,
): Promise<void> {
  const artifact = await readVerificationArtifact(options.artifact);
  const suiteName = suiteNameFromArtifactPath(options.artifact);
  await serveDashboard(
    await archivedDashboardSource(artifact, suiteName),
    options.open,
    normalizeHost(options.host),
    command.getOptionValueSource("host") !== "default",
  );
}

async function reportCommand(options: { artifact: string; output: string }): Promise<void> {
  const artifact = await readVerificationArtifact(options.artifact);
  const suiteName = suiteNameFromArtifactPath(options.artifact);
  const indexPath = await exportDashboardReport({
    artifact,
    suiteName,
    outputDirectory: options.output,
  });
  console.log(
    JSON.stringify(
      { artifactPath: path.resolve(options.artifact), reportPath: indexPath },
      null,
      JSON_INDENT_SPACES,
    ),
  );
}

export function registerDashboardCommands(program: Command): void {
  program.addCommand(
    subcommand(
      "dashboard",
      `Open dashboard aggregating every verification artifact under ${FRAMELIA_DIR}/.`,
    )
      .option("--project-root <dir>", "target project root")
      .option("--host [host]", "host to bind (bare flag binds every interface)", "localhost")
      .option("--no-open", "do not open dashboard in browser")
      .action(
        (options: { projectRoot?: string; open: boolean; host: string | true }, command: Command) =>
          runAggregatedDashboard({
            projectRoot: resolveProjectRoot(options.projectRoot),
            open: options.open,
            host: normalizeHost(options.host),
            hostExplicit: command.getOptionValueSource("host") !== "default",
          }),
      ),
    { isDefault: true },
  );
  program.addCommand(
    subcommand("open", "Open dashboard for an existing verification artifact.")
      .requiredOption("--artifact <path>", "verification artifact JSON")
      .option("--host [host]", "host to bind (bare flag binds every interface)", "localhost")
      .option("--no-open", "do not open dashboard in browser")
      .action(openCommand),
  );
  program.addCommand(
    subcommand("report", "Export a static dashboard report.")
      .requiredOption("--artifact <path>", "verification artifact JSON")
      .requiredOption("--output <dir>", "empty report output directory")
      .action(reportCommand),
  );
}
