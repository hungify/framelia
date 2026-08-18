import * as path from "node:path";

import { FRAMELIA_DIR } from "@framelia/contracts";
import {
  startDashboardServer,
  waitForDashboardShutdown,
  type DashboardSource,
} from "@framelia/dashboard-server";
import { JSON_INDENT_SPACES } from "@framelia/verify";
import type { Command } from "commander";
import openBrowser from "open";

import {
  aggregateDashboardSource,
  archivedDashboardSource,
  exportDashboardReport,
  readVerificationArtifact,
} from "../dashboard/report.ts";
import { resolveProjectRoot, subcommand } from "./shared.ts";

async function serveDashboard(source: DashboardSource, open: boolean): Promise<void> {
  const server = await startDashboardServer({ source });
  try {
    console.error(`Dashboard: ${server.url}`);
    if (open) await openBrowser(server.url);
    await waitForDashboardShutdown();
  } finally {
    await server.close();
  }
}

export async function runAggregatedDashboard(options: {
  projectRoot: string;
  open: boolean;
}): Promise<void> {
  await serveDashboard(await aggregateDashboardSource(options.projectRoot), options.open);
}

/** Recovers the suite name an artifact was captured under from its file path. */
function suiteNameFromArtifactPath(artifactPath: string): string {
  return path.basename(path.dirname(path.resolve(artifactPath)));
}

async function openCommand(options: { artifact: string; open: boolean }): Promise<void> {
  const artifact = await readVerificationArtifact(options.artifact);
  const suiteName = suiteNameFromArtifactPath(options.artifact);
  await serveDashboard(await archivedDashboardSource(artifact, suiteName), options.open);
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
      .option("--no-open", "do not open dashboard in browser")
      .action((options: { projectRoot?: string; open: boolean }) =>
        runAggregatedDashboard({
          projectRoot: resolveProjectRoot(options.projectRoot),
          open: options.open,
        }),
      ),
  );
  program.addCommand(
    subcommand("open", "Open dashboard for an existing verification artifact.")
      .requiredOption("--artifact <path>", "verification artifact JSON")
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
