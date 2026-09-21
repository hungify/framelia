import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  defaultClientRoot,
  projectSelectedRun,
  type DashboardSource,
} from "@framelia/dashboard-server";
import { JSON_INDENT_SPACES } from "@framelia/verify";
import { readSelectedRun } from "@framelia/verify/run-bundle";

export const DASHBOARD_RUN_FILE = "selected-run.json";
const REPORT_MARKER_FILE = ".framelia-report.json";
const REPORT_MARKER = "framelia-selected-run-dashboard-report";

/** Live source for exactly one explicit durable run. Refreshes from disk for running runs. */
export function selectedDashboardSource(
  projectRoot: string,
  runId: string,
  suiteName?: string,
): DashboardSource {
  return {
    snapshot: () =>
      projectSelectedRun(projectRoot, readSelectedRun(projectRoot, runId), suiteName).run,
    files: () =>
      projectSelectedRun(projectRoot, readSelectedRun(projectRoot, runId), suiteName).files,
  };
}

async function isPreviousFrameliaReport(outputDirectory: string): Promise<boolean> {
  return fs
    .readFile(path.join(outputDirectory, REPORT_MARKER_FILE), "utf8")
    .then((raw) => (JSON.parse(raw) as { marker?: string }).marker === REPORT_MARKER)
    .catch(() => false);
}

function sanitizePortableValue<T>(value: T, projectRoot: string): T {
  if (typeof value === "string") {
    return value.replaceAll(path.resolve(projectRoot), "<project-root>") as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePortableValue(entry, projectRoot)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizePortableValue(entry, projectRoot)]),
    ) as T;
  }
  return value;
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

  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(path.join(outputDirectory, "data"), { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, REPORT_MARKER_FILE),
    `${JSON.stringify({ marker: REPORT_MARKER, runId: options.runId })}\n`,
  );
  await fs.cp(clientRoot, outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "data", DASHBOARD_RUN_FILE),
    `${JSON.stringify(projection.run, null, JSON_INDENT_SPACES)}\n`,
  );
  const dataRoot = path.resolve(outputDirectory, "data");
  for (const [portablePath, sourcePath] of projection.files) {
    const destination = path.resolve(dataRoot, portablePath);
    if (!destination.startsWith(`${dataRoot}${path.sep}`)) {
      throw new Error(`Unsafe dashboard evidence path: ${portablePath}`);
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await copyPortableEvidence(sourcePath, destination, options.projectRoot);
  }
  return path.join(outputDirectory, "index.html");
}
