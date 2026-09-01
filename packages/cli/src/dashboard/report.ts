import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  verificationArtifactSchema,
  FRAMELIA_DIR,
  VISUAL_VERIFICATION_FILE,
  VISUAL_VERIFICATIONS_DIR,
  type DashboardContractResult,
  type DashboardRun,
  type VerificationArtifact,
} from "@framelia/contracts";
import {
  defaultClientRoot,
  overallStatus,
  projectArtifact,
  summarize,
  type DashboardProjection,
  type DashboardSource,
} from "@framelia/dashboard-server";
import { JSON_INDENT_SPACES, runWithConcurrency, type ContractDefaults } from "@framelia/verify";
import { nanoid } from "nanoid";

import { loadFrameliaConfig } from "../config.ts";

const MAX_DEFAULT_CONCURRENCY = 4;

/** Bounded default concurrency for parallel per-artifact work: min(4, CPU cores). */
function defaultConcurrency(): number {
  return Math.min(MAX_DEFAULT_CONCURRENCY, os.availableParallelism?.() ?? 2);
}

export async function readVerificationArtifact(filePath: string): Promise<VerificationArtifact> {
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read verification artifact ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return verificationArtifactSchema.parse(value);
}

export async function archivedDashboardSource(
  artifact: VerificationArtifact,
  suiteName?: string,
  defaults?: ContractDefaults,
): Promise<DashboardSource> {
  const projection = await projectArtifact(artifact, suiteName, defaults);
  return {
    snapshot: () => projection.run,
    files: () => projection.files,
  };
}

async function findVerificationArtifacts(
  projectRoot: string,
): Promise<Array<{ feature: string; filePath: string }>> {
  const base = path.join(projectRoot, FRAMELIA_DIR, VISUAL_VERIFICATIONS_DIR);
  let entries: string[];
  try {
    entries = (await fs.readdir(base, { recursive: true })) as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => {
      if (path.basename(entry) !== VISUAL_VERIFICATION_FILE) return false;
      const normalized = entry.split(path.sep).join("/");
      return !normalized.includes("/report/data/");
    })
    .map((entry) => ({
      feature: featureKeyFromArtifactEntry(entry),
      filePath: path.join(base, entry),
    }));
}

export function featureKeyFromArtifactEntry(entry: string): string {
  const parts = entry.split(path.sep);
  parts.pop();
  if (parts.length > 0 && parts[parts.length - 1]!.startsWith("run-")) parts.pop();
  return parts.join("/") || "root";
}

/**
 * Replaces every string leaf equal to a known virtual path with its remapped form.
 * Walks generically instead of naming each evidence field, so a contract field that
 * carries a virtual path (present in `remap`) is namespaced automatically -- including
 * ones added to DashboardContractResult after this function was written.
 */
function remapVirtualPaths<T>(value: T, remap: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (remap.get(value) ?? value) as T;
  if (Array.isArray(value)) return value.map((item) => remapVirtualPaths(item, remap)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        remapVirtualPaths(item, remap),
      ]),
    ) as T;
  }
  return value;
}

/**
 * `feature` is the full evidence directory path (arbitrary depth -- e.g. an unlighthouse-style
 * "host/port/route" namespace some setups use to keep environments from colliding). But
 * deriveContract (report-projection.ts) has its own narrower 2-level convention -- 1 feature
 * segment + 1 leaf segment per viewport/story -- and bakes *both* into contract.id by joining
 * them with "." (e.g. dir "login/desktop.page" -> id "login.desktop.page"). When id reveals
 * that convention, group by just the leading segment ("login") so every viewport of the same
 * page lands under one rail entry instead of one per viewport; otherwise keep the full path
 * as an opaque feature key, since that's what makes the unlighthouse-style layout collision-free.
 */
function groupingFeatureFor(feature: string, contractId: string): string {
  // deriveContract's own 2-level convention always makes contractId equal the full path
  // joined by "." too (its leaf segment IS "${leaf}.${scopeKind}"), so that broader match
  // has to be checked second -- otherwise it'd always win and the narrower, more useful
  // top-segment grouping below would never get a chance to fire.
  const topSegment = feature.split("/")[0]!;
  if (
    topSegment !== feature &&
    (contractId === topSegment ||
      contractId.startsWith(`${topSegment}-`) ||
      contractId.startsWith(`${topSegment}.`))
  ) {
    return topSegment;
  }
  return feature;
}

function withFeaturePrefix(projection: DashboardProjection, feature: string): DashboardProjection {
  const prefix = `${encodeURIComponent(feature)}/`;
  const remap = new Map<string, string>();
  const files = new Map<string, string>();
  for (const [virtual, real] of projection.files) {
    const prefixed = virtual.startsWith("contracts/") ? `${prefix}${virtual}` : virtual;
    remap.set(virtual, prefixed);
    files.set(prefixed, real);
  }
  const contracts: DashboardContractResult[] = projection.run.contracts.map((contract) => {
    const groupingFeature = groupingFeatureFor(feature, contract.id);
    // feature can use "/" for a nested evidence dir while contract.id stays "."-only --
    // normalize before comparing so a readable id (e.g. "login.desktop.page" from folder
    // "login/desktop.page") doesn't get doubled into "login/desktop.page.login.desktop.page".
    const normalizedFeature = groupingFeature.replaceAll("/", ".");
    return {
      ...remapVirtualPaths(contract, remap),
      feature: groupingFeature,
      // Prefix only when contract.id doesn't already carry the feature's identity (e.g.
      // legacy opaque-hash ids) -- otherwise it'd just double. A leaf id like
      // "login.desktop.page" already carries feature "login" via the "." delimiter
      // deriveContract/contractChildLabel use, so that counts as carrying it too.
      id:
        contract.id === normalizedFeature ||
        contract.id.startsWith(`${normalizedFeature}-`) ||
        contract.id.startsWith(`${normalizedFeature}.`)
          ? contract.id
          : `${groupingFeature}.${contract.id}`,
    };
  });
  return { files, run: { ...projection.run, contracts } };
}

export async function aggregateDashboardSource(projectRoot: string): Promise<DashboardSource> {
  const found = await findVerificationArtifacts(projectRoot);
  const defaults = await loadFrameliaConfig(projectRoot);
  // Each artifact is an independent file read + projection; run them concurrently
  // instead of paying every artifact's latency back to back, but bounded so a
  // repository with many artifacts can't exhaust file descriptors or memory.
  const projections = await runWithConcurrency(
    found,
    defaultConcurrency(),
    async ({ feature, filePath }) => {
      const artifact = await readVerificationArtifact(filePath);
      return withFeaturePrefix(await projectArtifact(artifact, feature, defaults), feature);
    },
  );

  const files = new Map<string, string>();
  const contracts: DashboardRun["contracts"] = [];
  let startedAt: string | undefined;
  let updatedAt: string | undefined;

  for (const projection of projections) {
    for (const contract of projection.run.contracts) contracts.push(contract);
    for (const [virtual, real] of projection.files) files.set(virtual, real);
    if (!startedAt || projection.run.startedAt < startedAt) startedAt = projection.run.startedAt;
    if (!updatedAt || projection.run.updatedAt > updatedAt) updatedAt = projection.run.updatedAt;
  }

  const summary = summarize(contracts);
  const now = new Date().toISOString();
  const run: DashboardRun = {
    schemaVersion: 1,
    runId: nanoid(),
    status: overallStatus(summary),
    summary,
    contracts,
    startedAt: startedAt ?? now,
    updatedAt: updatedAt ?? now,
    ...(updatedAt ? { finishedAt: updatedAt } : {}),
  };

  return {
    snapshot: () => run,
    files: () => files,
  };
}

const REPORT_MARKER_FILE = ".framelia-report.json";
const REPORT_MARKER = "framelia-dashboard-report";

async function isPreviousFrameliaReport(outputDirectory: string): Promise<boolean> {
  return fs
    .readFile(path.join(outputDirectory, REPORT_MARKER_FILE), "utf8")
    .then((raw) => (JSON.parse(raw) as { marker?: string }).marker === REPORT_MARKER)
    .catch(() => false);
}

export async function exportDashboardReport(options: {
  artifact: VerificationArtifact;
  suiteName?: string;
  outputDirectory: string;
  clientRoot?: string;
  defaults?: ContractDefaults;
}): Promise<string> {
  const outputDirectory = path.resolve(options.outputDirectory);
  const clientRoot = options.clientRoot ?? defaultClientRoot();
  for (const result of options.artifact.results) {
    const sourceRoot = path.resolve(result.outDir);
    if (outputDirectory === sourceRoot || outputDirectory.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error(`Report output may not be inside contract artifact directory: ${sourceRoot}`);
    }
  }
  // Guard above protects contract evidence. This second guard protects every other
  // directory: only an absent, empty, or a directory this function itself previously
  // wrote (identified by a Framelia-specific marker, not by a generic file like
  // index.html that any unrelated static site could also contain) may be cleared.
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
  const projection = await projectArtifact(options.artifact, options.suiteName, options.defaults);
  await fs.mkdir(path.join(outputDirectory, "data"), { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, REPORT_MARKER_FILE),
    `${JSON.stringify({ marker: REPORT_MARKER })}\n`,
  );
  await fs.cp(clientRoot, outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(outputDirectory, "data", VISUAL_VERIFICATION_FILE),
    `${JSON.stringify(projection.run, null, JSON_INDENT_SPACES)}\n`,
  );
  for (const [relativePath, sourcePath] of projection.files) {
    const destination = path.resolve(outputDirectory, "data", relativePath);
    const dataRoot = path.resolve(outputDirectory, "data");
    if (!destination.startsWith(`${dataRoot}${path.sep}`))
      throw new Error(`Unsafe dashboard artifact path: ${relativePath}`);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(sourcePath, destination);
  }
  return path.join(outputDirectory, "index.html");
}
