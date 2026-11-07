import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  defaultClientRoot,
  projectSelectedRun,
  type DashboardSource,
} from "@framelia/dashboard-server";
import { JSON_INDENT_SPACES, sanitizePortableValue } from "@framelia/verify";
import { cacheSelectedRunProjection, readSelectedRun } from "@framelia/verify/run-bundle";

export const DASHBOARD_RUN_FILE = "selected-run.json";
const REPORT_MARKER_FILE = ".framelia-report.json";
const REPORT_MARKER = "framelia-selected-run-dashboard-report";

/**
 * Live source for exactly one explicit durable run. Refreshes from disk when the run
 * changes; snapshot() and files() share one projection per change.
 */
export function selectedDashboardSource(
  projectRoot: string,
  runId: string,
  suiteName?: string,
): DashboardSource {
  const projection = cacheSelectedRunProjection(projectRoot, runId, (selectedRun) =>
    projectSelectedRun(projectRoot, selectedRun, suiteName),
  );
  return {
    snapshot: () => projection().run,
    files: () => projection().files,
  };
}

async function isPreviousFrameliaReport(outputDirectory: string): Promise<boolean> {
  return fs
    .readFile(path.join(outputDirectory, REPORT_MARKER_FILE), "utf8")
    .then((raw) => (JSON.parse(raw) as { marker?: string }).marker === REPORT_MARKER)
    .catch(() => false);
}

async function copyPortableEvidence(
  sourcePath: string,
  destination: string,
  projectRoot: string,
): Promise<void> {
  if (path.extname(sourcePath) !== ".json") {
    await fs.copyFile(sourcePath, destination);
    return;
  }
  const value = JSON.parse(await fs.readFile(sourcePath, "utf8")) as unknown;
  await fs.writeFile(
    destination,
    `${JSON.stringify(sanitizePortableValue(value, projectRoot), null, JSON_INDENT_SPACES)}\n`,
  );
}

/** Exports the exact same selected-run projection served by the live dashboard. */
export async function exportDashboardReport(options: {
  projectRoot: string;
  runId: string;
  outputDirectory: string;
  suiteName?: string;
  clientRoot?: string;
}): Promise<string> {
  const outputDirectory = path.resolve(options.outputDirectory);
  const clientRoot = options.clientRoot ?? defaultClientRoot();
  const projection = projectSelectedRun(
    options.projectRoot,
    readSelectedRun(options.projectRoot, options.runId),
    options.suiteName,
  );
  for (const sourcePath of projection.files.values()) {
    const sourceRoot = path.dirname(sourcePath);
    if (outputDirectory === sourceRoot || outputDirectory.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error(
        `Report output may not be inside selected-run evidence directory: ${sourceRoot}`,
      );
    }
  }
  const existing = await fs.readdir(outputDirectory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [] as string[];
    throw error;
  });
  if (existing.length > 0 && !(await isPreviousFrameliaReport(outputDirectory))) {
    throw new Error(
      `Report output directory is not empty and is not a previous Framelia report: ${outputDirectory}`,
    );
  }

  // Build next to the destination (same filesystem, so the swap is a rename) and only replace
  // a previous report once the new one is complete: a failed export never loses the old one.
  await fs.mkdir(path.dirname(outputDirectory), { recursive: true });
  const staging = await fs.mkdtemp(`${outputDirectory}.framelia-staging-`);
  try {
    await writeReport(staging, clientRoot, projection, options);
    await swapIntoPlace(staging, outputDirectory, await exists(outputDirectory));
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
  return path.join(outputDirectory, "index.html");
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(
    () => true,
    () => false,
  );
}

async function writeReport(
  directory: string,
  clientRoot: string,
  projection: ReturnType<typeof projectSelectedRun>,
  options: { projectRoot: string; runId: string },
): Promise<void> {
  await fs.mkdir(path.join(directory, "data"), { recursive: true });
  await fs.writeFile(
    path.join(directory, REPORT_MARKER_FILE),
    `${JSON.stringify({ marker: REPORT_MARKER, runId: options.runId })}\n`,
  );
  await fs.cp(clientRoot, directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "data", DASHBOARD_RUN_FILE),
    `${JSON.stringify(projection.run, null, JSON_INDENT_SPACES)}\n`,
  );
  const dataRoot = path.resolve(directory, "data");
  for (const [portablePath, sourcePath] of projection.files) {
    const destination = path.resolve(dataRoot, portablePath);
    if (!destination.startsWith(`${dataRoot}${path.sep}`)) {
      throw new Error(`Unsafe dashboard evidence path: ${portablePath}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await copyPortableEvidence(sourcePath, destination, options.projectRoot);
  }
}

/** Moves a complete report into place, restoring the previous one if the final rename fails. */
async function swapIntoPlace(
  staging: string,
  outputDirectory: string,
  replacing: boolean,
): Promise<void> {
  if (!replacing) {
    await fs.rename(staging, outputDirectory);
    return;
  }
  const retired = `${staging}-previous`;
  await fs.rename(outputDirectory, retired);
  try {
    await fs.rename(staging, outputDirectory);
  } catch (error) {
    await fs.rename(retired, outputDirectory);
    throw error;
  }
  await fs.rm(retired, { recursive: true, force: true });
}
