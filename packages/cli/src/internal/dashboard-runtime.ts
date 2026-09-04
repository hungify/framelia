import { promises as dns } from "node:dns";
import * as os from "node:os";
import * as readline from "node:readline";

import {
  startDashboardServer,
  waitForDashboardShutdown,
  type DashboardServer,
  type DashboardSource,
} from "@framelia/dashboard-server";
import openBrowser from "open";

const LOCALHOST_LOOKUP_TIMEOUT_MS = 1_000;

export interface DashboardNetworkContext {
  readonly localhostAlias: string | undefined;
  readonly networkInterfaces: NodeJS.Dict<
    readonly { readonly address?: string; readonly family: string | number }[]
  >;
}

export interface DashboardHost {
  readonly startServer: (options: {
    source: DashboardSource;
    hostname: string;
    port: number;
  }) => Promise<DashboardServer>;
  readonly networkContext: () => Promise<DashboardNetworkContext>;
  readonly openBrowser: (url: string) => Promise<unknown>;
  readonly listenForInput: (listener: (line: string) => void) => (() => void) | undefined;
  readonly now: () => number;
  readonly waitForShutdown: () => Promise<void>;
}

async function localhostAddressIfDiffersFromDns(): Promise<string | undefined> {
  if (dns.getDefaultResultOrder?.() === "verbatim") return undefined;
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(() => resolve(undefined), LOCALHOST_LOOKUP_TIMEOUT_MS),
  );
  const lookup = Promise.all([dns.lookup("localhost"), dns.lookup("localhost", { verbatim: true })])
    .then(([nodeResult, dnsResult]) =>
      nodeResult.family === dnsResult.family && nodeResult.address === dnsResult.address
        ? undefined
        : nodeResult.address,
    )
    .catch(() => undefined);
  return Promise.race([lookup, timeout]);
}

export const productionDashboardHost: DashboardHost = {
  startServer: startDashboardServer,
  async networkContext() {
    return {
      localhostAlias: await localhostAddressIfDiffersFromDns(),
      networkInterfaces: os.networkInterfaces(),
    };
  },
  openBrowser: (url) => openBrowser(url),
  listenForInput(listener) {
    if (!process.stdin.isTTY || process.env.CI) return undefined;
    const input = readline.createInterface({ input: process.stdin });
    input.on("line", listener);
    return () => input.close();
  },
  now: () => performance.now(),
  waitForShutdown: waitForDashboardShutdown,
};
