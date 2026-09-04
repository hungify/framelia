import { promises as dns } from "node:dns";
import * as os from "node:os";
import * as readline from "node:readline";

import {
  startDashboardServer,
  waitForDashboardShutdown,
  type DashboardSource,
} from "@framelia/dashboard-server";
import openBrowser from "open";

import type { DashboardHost } from "../dashboard-types.ts";

const LOCALHOST_LOOKUP_TIMEOUT_MS = 1_000;

/** Resolves to `undefined` (same as "no difference found") if the lookup doesn't finish
 *  quickly, or fails outright -- a sandboxed/containerized network namespace (e.g. CI)
 *  can make `dns.lookup` take much longer than this purely cosmetic check (a nicer
 *  banner URL) is worth blocking the ready banner on, or reject it with
 *  ENOTFOUND/EAI_AGAIN. Neither is a reason to fail `framelia dashboard`. */
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

/**
 * Production `DashboardHost`: real server lifecycle, DNS, network interfaces, browser,
 * readline, clock, and shutdown signal -- the one place this rewrite's dashboard code
 * touches those actual Node/third-party APIs. Dashboard tests substitute a fake host
 * instead of importing this module. `isTTY()` folds in the old CLI's separate
 * `process.env.CI` check (`DashboardHost` has no `env` field of its own, since both
 * conditions only ever gated the same "should we listen for shortcuts" decision).
 */
export const productionDashboardHost: DashboardHost = {
  async startServer({ source, hostname, port }) {
    return startDashboardServer({ source: source as DashboardSource, hostname, port });
  },
  lookupLocalhost: localhostAddressIfDiffersFromDns,
  networkInterfaces: () => os.networkInterfaces(),
  openBrowser: (url) => openBrowser(url),
  isTTY: () => Boolean(process.stdin.isTTY) && !process.env.CI,
  stdin: process.stdin,
  createReadline: () => readline.createInterface({ input: process.stdin }),
  now: () => performance.now(),
  waitForShutdown: waitForDashboardShutdown,
};
