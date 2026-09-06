/**
 * The `framelia` package's library surface. Deliberately narrow: everything a
 * `framelia.config.ts` or a programmatic dashboard export needs, and nothing
 * else. Schemas and verification primitives are reached through
 * `@framelia/contracts` and `@framelia/verify` directly -- forwarding them here
 * gave every symbol a second import path without adding behaviour.
 */
export { defineConfig, loadFrameliaConfig } from "./config.ts";
export type { FrameliaConfig, ResolvedFrameliaConfig } from "./config.ts";
export {
  archivedDashboardSource,
  exportDashboardReport,
  readVerificationArtifact,
} from "./dashboard/report.ts";
export {
  projectArtifact,
  startDashboardServer,
  waitForDashboardShutdown,
} from "@framelia/dashboard-server";
export type { DashboardServer, DashboardSource } from "@framelia/dashboard-server";
