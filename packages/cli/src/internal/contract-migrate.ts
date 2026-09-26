import * as fs from "node:fs";
import * as path from "node:path";

import {
  CONTRACT_FORMAT_VERSION,
  authoredContractSchema,
  migrationInputMapSchema,
  targetPathSchema,
  type AuthoredContract,
  type Diagnostic,
  type MigrationContractInput,
  type MigrationInputMap,
} from "@framelia/contracts/workflow";
import {
  AppError,
  assertRawFileState,
  canonicalJsonDigest,
  clearMigrationTransaction,
  fsyncDirectory,
  publishBaselineSnapshot,
  readMigrationTransaction,
  readPinnedBaseline,
  stageFigmaBaseline,
  withAuthoringLock,
  writeAuthoredContract,
  writeFileAtomic,
  writeMigrationTransaction,
  type CanonicalJsonValue,
  type FetchBaselineFn,
  type MigrationTransactionTarget,
  type StagedBaselineSnapshot,
} from "@framelia/verify";
import {
  inspectAuthoredContracts,
  inspectLegacyContracts,
  type LegacyContractCandidate,
  type ResolvedProjectPolicy,
} from "@framelia/verify/project-policy";
import { nanoid } from "nanoid";

import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { optionalFigmaToken } from "./figma-token.ts";
import { openProject } from "./project.ts";
import { PROMPT_CANCELLED, type PromptAdapter } from "./prompts.ts";

const MIGRATE_OUTCOME_FORMAT_VERSION = 1 as const;

/** Placeholder snapshot digest recorded on a plan whose Figma refresh is deferred to
 *  execution (network I/O never happens during resolution or dry-run). Execution always
 *  replaces it with the digest actually staged before building the new contract object. */
const PENDING_REFRESH_SNAPSHOT_DIGEST = `sha256:${"0".repeat(64)}`;

export interface ContractMigrateOptions {
  readonly projectRoot: string | undefined;
  readonly dryRun: boolean | undefined;
  readonly contract: string[] | undefined;
  readonly map: string | undefined;
  readonly recover: boolean | undefined;
}

export interface ContractMigrateDependencies {
  readonly fetchBaseline?: FetchBaselineFn;
  /** Test seam: invoked right after the transaction marker is durably written, before
   *  any target file is touched -- lets a test simulate a crash mid-transaction. */
  readonly afterTransactionMarkerWritten?: () => void;
}

export interface ContractMigratedEntry {
  readonly contractId: string;
  readonly legacyFile: string;
  readonly path: string;
  /** Content digest of the written contract file; absent on a dry-run preview entry,
   *  which has not computed final bytes (a baseline refresh may still be pending). */
  readonly digest?: `sha256:${string}`;
  /** Absent when the entry's baseline resolution is a deferred Figma refresh -- the real
   *  digest is only known once write mode actually stages it. */
  readonly snapshotDigest?: string;
  readonly removedOrigin?: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ContractMigrateUnresolvedEntry {
  readonly contractId: string;
  readonly legacyFile: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ContractMigrateOutcome {
  readonly formatVersion: typeof MIGRATE_OUTCOME_FORMAT_VERSION;
  readonly kind: "framelia.contract-migrate-outcome";
  readonly command: "contract migrate";
  readonly executionState: "completed" | "blocked" | "error";
  readonly dryRun: boolean;
  readonly exitCode: 0 | 2;
  readonly migrated: readonly ContractMigratedEntry[];
  readonly unresolved: readonly ContractMigrateUnresolvedEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly next?: { command: string; argv: string[] };
}

function issue(code: string, stage: string, message: string, field?: string): Diagnostic {
  return field === undefined ? { code, stage, message } : { code, stage, message, field };
}

function errorOutcome(error: unknown, dryRun: boolean): CliResult<ContractMigrateOutcome> {
  return {
    ok: false,
    exitCode: 2,
    body: {
      formatVersion: MIGRATE_OUTCOME_FORMAT_VERSION,
      kind: "framelia.contract-migrate-outcome",
      command: "contract migrate",
      executionState: "error",
      dryRun,
      exitCode: 2,
      migrated: [],
      unresolved: [],
      diagnostics: [
        issue(
          error instanceof AppError ? error.code : "CONTRACT_MIGRATE_FAILED",
          "migrate",
          error instanceof Error ? error.message : String(error),
        ),
      ],
    },
  };
}

function buildOutcome(
  dryRun: boolean,
  migrated: readonly ContractMigratedEntry[],
  unresolved: readonly ContractMigrateUnresolvedEntry[],
  diagnostics: readonly Diagnostic[],
  projectRoot: string | undefined,
): CliResult<ContractMigrateOutcome> {
  const blocked = unresolved.length > 0 || diagnostics.length > 0;
  const exitCode: 0 | 2 = blocked ? 2 : 0;
  const next = blocked
    ? {
        command: "framelia",
        argv: [
          "contract",
          "migrate",
          "--dry-run",
          ...(projectRoot ? ["--project-root", projectRoot] : []),
        ],
      }
    : dryRun && migrated.length > 0
      ? {
          command: "framelia",
          argv: ["contract", "migrate", ...(projectRoot ? ["--project-root", projectRoot] : [])],
        }
      : undefined;
  return {
    ok: !blocked,
    exitCode,
    body: {
      formatVersion: MIGRATE_OUTCOME_FORMAT_VERSION,
      kind: "framelia.contract-migrate-outcome",
      command: "contract migrate",
      executionState: blocked ? "blocked" : "completed",
      dryRun,
      exitCode,
      migrated,
      unresolved,
      diagnostics,
      ...(next ? { next } : {}),
    },
  };
}

function portablePath(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function newFileFor(root: string, contractId: string): string {
  return path.resolve(root, ".framelia", "contracts", contractId, "visual-contract.json");
}

function loadMigrationInputMap(root: string, mapOption: string | undefined): MigrationInputMap {
  if (!mapOption) return {};
  const mapPath = path.resolve(root, mapOption);
  let raw: string;
  try {
    raw = fs.readFileSync(mapPath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read --map file ${mapOption}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `--map file ${mapOption} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const result = migrationInputMapSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(`--map file ${mapOption} failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

/** `pathname` always begins with exactly one slash for any URL `webTargetSchema` already
 *  proved is `http`/`https` -- the only failure mode `targetPathSchema` can still catch is
 *  a doubled leading slash (`https://x.test//foo`), surfaced as an unresolved route rather
 *  than silently reinterpreted. */
function deriveRouteFromLegacyUrl(url: string): { path: string; origin: string } | undefined {
  const parsed = new URL(url);
  const candidatePath = `${parsed.pathname}${parsed.search}`;
  return targetPathSchema.safeParse(candidatePath).success
    ? { path: candidatePath, origin: parsed.origin }
    : undefined;
}

interface ResolvedMigrationPlan {
  readonly candidate: LegacyContractCandidate;
  readonly targetPath: string;
  readonly removedOrigin: string | undefined;
  readonly projects: string[];
  readonly snapshotDigest: string;
  readonly infoDiagnostics: Diagnostic[];
}

interface ContractResolution {
  readonly plan: ResolvedMigrationPlan | undefined;
  readonly blockers: Diagnostic[];
}

async function resolveRoute(
  candidate: LegacyContractCandidate,
  input: MigrationContractInput | undefined,
  prompts: PromptAdapter,
): Promise<{ targetPath: string | undefined; removedOrigin: string | undefined }> {
  if (input?.targetPath) return { targetPath: input.targetPath, removedOrigin: undefined };
  if (candidate.target) {
    const derived = deriveRouteFromLegacyUrl(candidate.target.url);
    if (derived) {
      if (prompts.interactive) {
        prompts.note(
          `${candidate.contract.id}: using route ${derived.path} (removed origin ${derived.origin}).`,
          "Route derived from legacy URL",
        );
      }
      return { targetPath: derived.path, removedOrigin: derived.origin };
    }
  }
  if (prompts.interactive) {
    const entered = await prompts.text({
      message: `${candidate.contract.id}: legacy route could not be derived. Enter the application-relative target path (e.g. /login?state=error).`,
      validate: (value) =>
        value && targetPathSchema.safeParse(value).success
          ? undefined
          : "Enter a path beginning with one slash.",
    });
    if (entered !== PROMPT_CANCELLED) return { targetPath: entered, removedOrigin: undefined };
  }
  return { targetPath: undefined, removedOrigin: undefined };
}

async function resolveProjects(
  candidate: LegacyContractCandidate,
  input: MigrationContractInput | undefined,
  policy: ResolvedProjectPolicy,
  prompts: PromptAdapter,
): Promise<{ projects: string[] | undefined; blocker: Diagnostic | undefined }> {
  let projects = input?.projects;
  if (projects === undefined && prompts.interactive && policy.playwright) {
    const entered = await prompts.text({
      message: `${candidate.contract.id}: confirm target Playwright projects (comma-separated).`,
      initialValue: policy.playwright.projects.join(", "),
    });
    if (entered !== PROMPT_CANCELLED) {
      projects = entered
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
    }
  }
  if (projects === undefined) {
    return {
      projects: undefined,
      blocker: issue(
        "MIGRATION_PROJECTS_UNRESOLVED",
        "resolution",
        `${candidate.contract.id}: legacy contracts carry no project matrix; supply projects in --map.`,
        "projects",
      ),
    };
  }
  if (policy.playwright) {
    const configured = new Set(policy.playwright.projects);
    const unknown = projects.filter((name) => !configured.has(name));
    if (unknown.length > 0) {
      return {
        projects: undefined,
        blocker: issue(
          "UNKNOWN_PLAYWRIGHT_PROJECT",
          "resolution",
          `${candidate.contract.id}: unknown configured Playwright project(s): ${unknown.join(", ")}.`,
          "projects",
        ),
      };
    }
  }
  return { projects, blocker: undefined };
}

interface BaselineResolution {
  readonly snapshotDigest: string | undefined;
  readonly infoDiagnostics: Diagnostic[];
  readonly blockers: Diagnostic[];
}

async function resolveBaseline(
  candidate: LegacyContractCandidate,
  input: MigrationContractInput | undefined,
  targetPath: string | undefined,
  root: string,
  prompts: PromptAdapter,
  dryRun: boolean,
): Promise<BaselineResolution> {
  const legacy = candidate.contract;
  let snapshotDigest = input?.snapshotDigest;
  let wantsRefresh = input?.refreshBaseline === true;

  if (snapshotDigest === undefined && !wantsRefresh && prompts.interactive) {
    const choice = await prompts.select({
      message: `${legacy.id}: no baseline resolution supplied. Adopt an existing pinned snapshot, or refresh from Figma now?`,
      options: [
        { value: "digest", label: "Adopt an already-published pinned snapshot digest" },
        { value: "refresh", label: "Refresh a fresh reviewable snapshot from Figma" },
      ],
    });
    if (choice === "digest") {
      const entered = await prompts.text({
        message: `${legacy.id}: pinned snapshotDigest (sha256:...).`,
      });
      if (entered !== PROMPT_CANCELLED) snapshotDigest = entered;
    } else if (choice === "refresh") {
      wantsRefresh = true;
    }
  }

  if (snapshotDigest !== undefined) {
    const provisional = authoredContractSchema.safeParse({
      formatVersion: CONTRACT_FORMAT_VERSION,
      kind: "framelia.contract",
      id: legacy.id,
      name: legacy.name,
      revision: 1,
      target: { path: targetPath ?? "/" },
      viewport: legacy.viewport,
      scope: legacy.scope,
      baseline: { snapshotDigest },
      required: true,
    });
    if (!provisional.success) {
      return {
        snapshotDigest: undefined,
        infoDiagnostics: [],
        blockers: [
          issue(
            "MIGRATION_BASELINE_UNRESOLVED",
            "resolution",
            `${legacy.id}: supplied snapshotDigest could not be validated: ${provisional.error.message}`,
            "snapshotDigest",
          ),
        ],
      };
    }
    try {
      await readPinnedBaseline(root, provisional.data);
      return { snapshotDigest, infoDiagnostics: [], blockers: [] };
    } catch (error) {
      return {
        snapshotDigest: undefined,
        infoDiagnostics: [],
        blockers: [
          issue(
            error instanceof AppError ? error.code : "MIGRATION_BASELINE_UNRESOLVED",
            "resolution",
            `${legacy.id}: ${error instanceof Error ? error.message : String(error)}`,
            "snapshotDigest",
          ),
        ],
      };
    }
  }

  if (wantsRefresh) {
    return dryRun
      ? {
          snapshotDigest: PENDING_REFRESH_SNAPSHOT_DIGEST,
          infoDiagnostics: [
            issue(
              "MIGRATION_BASELINE_REFRESH_PLANNED",
              "resolution",
              `${legacy.id}: dry-run never fetches from Figma; write mode will acquire a fresh reviewable snapshot.`,
              "snapshotDigest",
            ),
          ],
          blockers: [],
        }
      : { snapshotDigest: PENDING_REFRESH_SNAPSHOT_DIGEST, infoDiagnostics: [], blockers: [] };
  }

  return {
    snapshotDigest: undefined,
    infoDiagnostics: [],
    blockers: [
      issue(
        "MIGRATION_BASELINE_UNRESOLVED",
        "resolution",
        `${legacy.id}: legacy output PNGs/caches are never auto-approved; supply a validated snapshotDigest or refreshBaseline in --map.`,
        "snapshotDigest",
      ),
    ],
  };
}

async function resolveOneContract(
  candidate: LegacyContractCandidate,
  input: MigrationContractInput | undefined,
  policy: ResolvedProjectPolicy,
  root: string,
  prompts: PromptAdapter,
  dryRun: boolean,
): Promise<ContractResolution> {
  const blockers: Diagnostic[] = [];
  const infoDiagnostics: Diagnostic[] = [];

  const route = await resolveRoute(candidate, input, prompts);
  if (route.targetPath === undefined) {
    blockers.push(
      issue(
        "MIGRATION_ROUTE_UNRESOLVED",
        "resolution",
        `${candidate.contract.id}: no route could be derived from the legacy request URL; supply targetPath in --map.`,
        "targetPath",
      ),
    );
  }

  const projectsResult = await resolveProjects(candidate, input, policy, prompts);
  if (projectsResult.blocker) blockers.push(projectsResult.blocker);

  const baseline = await resolveBaseline(candidate, input, route.targetPath, root, prompts, dryRun);
  blockers.push(...baseline.blockers);
  infoDiagnostics.push(...baseline.infoDiagnostics);

  if (candidate.contract.clusterCheck !== undefined) {
    infoDiagnostics.push(
      issue(
        "MIGRATION_FIELD_DROPPED",
        "resolution",
        `${candidate.contract.id}: legacy clusterCheck has no analogue in the authored contract schema and was not carried over.`,
        "clusterCheck",
      ),
    );
  }

  if (
    blockers.length > 0 ||
    route.targetPath === undefined ||
    projectsResult.projects === undefined ||
    baseline.snapshotDigest === undefined
  ) {
    return { plan: undefined, blockers };
  }

  return {
    plan: {
      candidate,
      targetPath: route.targetPath,
      removedOrigin: route.removedOrigin,
      projects: projectsResult.projects,
      snapshotDigest: baseline.snapshotDigest,
      infoDiagnostics,
    },
    blockers: [],
  };
}

function buildNewContract(plan: ResolvedMigrationPlan, snapshotDigest: string): AuthoredContract {
  const legacy = plan.candidate.contract;
  return authoredContractSchema.parse({
    formatVersion: CONTRACT_FORMAT_VERSION,
    kind: "framelia.contract",
    id: legacy.id,
    name: legacy.name,
    revision: 1,
    target: { path: plan.targetPath },
    viewport: legacy.viewport,
    scope: legacy.scope,
    baseline: { snapshotDigest },
    required: true,
    projects: plan.projects,
    ...(legacy.profile !== undefined ? { profile: legacy.profile } : {}),
    ...(legacy.profileOverrides ? { profileOverrides: legacy.profileOverrides } : {}),
    ...(legacy.styleToleranceOverrides
      ? { styleToleranceOverrides: legacy.styleToleranceOverrides }
      : {}),
    ...(legacy.gateEligible !== undefined ? { gateEligible: legacy.gateEligible } : {}),
    ...(legacy.styleGateEligible !== undefined
      ? { styleGateEligible: legacy.styleGateEligible }
      : {}),
    ...(legacy.masks ? { masks: legacy.masks } : {}),
  });
}

function applyLegacyCleanup(
  root: string,
  legacyFile: string,
  legacyAction: "delete-file" | "rewrite-file",
  contractIds: ReadonlySet<string>,
): void {
  const absolute = path.resolve(root, legacyFile);
  if (!fs.existsSync(absolute)) return;
  if (legacyAction === "delete-file") {
    fs.rmSync(absolute);
    fsyncDirectory(path.dirname(absolute));
    return;
  }
  const rawJson = JSON.parse(fs.readFileSync(absolute, "utf8")) as { contracts?: unknown };
  if (!Array.isArray(rawJson.contracts)) return;
  const remaining = rawJson.contracts.filter(
    (entry) =>
      !(entry && typeof entry === "object" && "id" in entry && contractIds.has(String(entry.id))),
  );
  if (remaining.length === rawJson.contracts.length) return;
  writeFileAtomic(absolute, `${JSON.stringify({ ...rawJson, contracts: remaining }, null, 2)}\n`);
}

/** Finishes (or no-ops on) every target of a pending marker, then clears it. Recovery is
 *  self-contained and idempotent: each target's `newContract` is a fully-resolved object,
 *  not just a digest, so replaying `writeAuthoredContract` needs no re-resolution, network
 *  access, or prompting -- it can always finish deterministically from the marker alone. */
function finishTransactionTargets(
  root: string,
  targets: readonly MigrationTransactionTarget[],
): void {
  for (const target of targets) {
    writeAuthoredContract(path.resolve(root, target.newFile), target.newContract);
  }
  const legacyGroups = new Map<
    string,
    { action: "delete-file" | "rewrite-file"; ids: Set<string> }
  >();
  for (const target of targets) {
    const group = legacyGroups.get(target.legacyFile);
    if (group) group.ids.add(target.contractId);
    else
      legacyGroups.set(target.legacyFile, {
        action: target.legacyAction,
        ids: new Set([target.contractId]),
      });
  }
  for (const [legacyFile, group] of legacyGroups) {
    applyLegacyCleanup(root, legacyFile, group.action, group.ids);
  }
  clearMigrationTransaction(root);
}

function migratedEntryFrom(target: MigrationTransactionTarget, removedOrigin: string | undefined) {
  return {
    contractId: target.contractId,
    legacyFile: target.legacyFile,
    path: target.newFile,
    digest: canonicalJsonDigest(target.newContract as CanonicalJsonValue),
    snapshotDigest: target.newContract.baseline.snapshotDigest,
    ...(removedOrigin ? { removedOrigin } : {}),
    diagnostics: [] as Diagnostic[],
  };
}

async function executeMigration(
  root: string,
  policy: ResolvedProjectPolicy,
  plans: readonly ResolvedMigrationPlan[],
  legacySiblingIds: ReadonlyMap<string, ReadonlySet<string>>,
  runtime: CliRuntime,
  dependencies: ContractMigrateDependencies,
): Promise<ContractMigratedEntry[]> {
  // Capture "before" state from the discovery-time digest, not a fresh read here --
  // resolution (including interactive prompts) runs between discovery and this point,
  // so re-reading now would silently accept an edit that happened during resolution as
  // long as nothing changed afterward. Comparing against the digest `plan.candidate`
  // was actually parsed from ensures any edit since discovery is caught once the lock
  // is acquired, including edits made during the network-bound staging window below.
  const before = plans.map((plan) => ({
    plan,
    legacyBefore: { exists: true as const, digest: plan.candidate.fileDigest },
  }));

  // Stage every Figma refresh outside the lock (network I/O), mirroring contract create.
  const staged = new Map<string, StagedBaselineSnapshot>();
  for (const plan of plans) {
    if (plan.snapshotDigest !== PENDING_REFRESH_SNAPSHOT_DIGEST) continue;
    const legacy = plan.candidate.contract;
    const result = await stageFigmaBaseline({
      source: legacy.baseline,
      viewport: legacy.viewport,
      scope: legacy.scope,
      token: optionalFigmaToken(runtime),
      ...(dependencies.fetchBaseline ? { fetchBaseline: dependencies.fetchBaseline } : {}),
    });
    staged.set(plan.candidate.contract.id, result);
  }

  return withAuthoringLock(root, async () => {
    for (const { plan, legacyBefore } of before) {
      assertRawFileState(path.resolve(root, plan.candidate.file), legacyBefore);
    }
    const latestAuthored = await inspectAuthoredContracts(policy);
    const authoredIds = new Set(latestAuthored.contracts.map((entry) => entry.contract.id));
    for (const plan of plans) {
      if (authoredIds.has(plan.candidate.contract.id)) {
        throw new AppError(
          "AUTHORING_CONFLICT",
          `Contract ${plan.candidate.contract.id} was authored concurrently while migration was in progress.`,
        );
      }
    }

    const targets: MigrationTransactionTarget[] = plans.map((plan) => {
      const snapshotDigest =
        staged.get(plan.candidate.contract.id)?.snapshotDigest ?? plan.snapshotDigest;
      const newContract = buildNewContract(plan, snapshotDigest);
      const siblings =
        legacySiblingIds.get(plan.candidate.file) ?? new Set([plan.candidate.contract.id]);
      const migratingFromThisFile = new Set(
        plans
          .filter((entry) => entry.candidate.file === plan.candidate.file)
          .map((entry) => entry.candidate.contract.id),
      );
      const remaining = [...siblings].filter((id) => !migratingFromThisFile.has(id));
      return {
        contractId: plan.candidate.contract.id,
        legacyFile: plan.candidate.file,
        legacyFileDigestBefore: plan.candidate.fileDigest,
        legacyAction: remaining.length === 0 ? "delete-file" : "rewrite-file",
        newFile: portablePath(root, newFileFor(root, plan.candidate.contract.id)),
        newContract,
      };
    });

    writeMigrationTransaction(root, {
      formatVersion: 1,
      kind: "framelia.migration-transaction",
      startedAt: new Date().toISOString(),
      pid: process.pid,
      token: nanoid(),
      targets,
    });
    dependencies.afterTransactionMarkerWritten?.();

    for (const target of targets) {
      const stagedSnapshot = staged.get(target.contractId);
      if (stagedSnapshot) await publishBaselineSnapshot(root, target.newContract, stagedSnapshot);
    }

    writeMigrationTransaction(root, {
      formatVersion: 1,
      kind: "framelia.migration-transaction",
      startedAt: new Date().toISOString(),
      pid: process.pid,
      token: nanoid(),
      targets,
    });
    dependencies.afterTransactionMarkerWritten?.();

    finishTransactionTargets(root, targets);

    return targets.map((target) => {
      const plan = plans.find((entry) => entry.candidate.contract.id === target.contractId);
      return migratedEntryFrom(target, plan?.removedOrigin);
    });
  });
}

async function recover(
  root: string,
  dryRun: boolean,
  projectRoot: string | undefined,
): Promise<CliResult<ContractMigrateOutcome>> {
  const marker = readMigrationTransaction(root);
  if (!marker) return buildOutcome(dryRun, [], [], [], projectRoot);
  if (dryRun) {
    return buildOutcome(
      dryRun,
      [],
      marker.targets.map((target) => ({
        contractId: target.contractId,
        legacyFile: target.legacyFile,
        diagnostics: [
          issue(
            "MIGRATION_INCOMPLETE",
            "recovery",
            `${target.contractId}: pending migration to ${target.newFile}; recover with write mode to finish or inspect manually.`,
          ),
        ],
      })),
      [],
      projectRoot,
    );
  }
  const migrated = await withAuthoringLock(root, () => {
    finishTransactionTargets(root, marker.targets);
    return marker.targets.map((target) => migratedEntryFrom(target, undefined));
  });
  return buildOutcome(dryRun, migrated, [], [], projectRoot);
}

export async function contractMigrateCommand(
  options: ContractMigrateOptions,
  prompts: PromptAdapter,
  runtime: CliRuntime,
  dependencies: ContractMigrateDependencies = {},
): Promise<CliResult<ContractMigrateOutcome>> {
  const dryRun = options.dryRun ?? false;
  prompts.intro("Migrate legacy visual contracts");
  try {
    const project = openProject(options.projectRoot, runtime);
    const policy = await project.loadConfig();

    if (options.recover) {
      const result = await recover(project.root, dryRun, options.projectRoot);
      prompts.outro(result.ok ? "Recovery finished." : "Recovery could not complete.");
      return result;
    }

    const pending = readMigrationTransaction(project.root);
    if (pending) {
      return buildOutcome(
        dryRun,
        [],
        pending.targets.map((target) => ({
          contractId: target.contractId,
          legacyFile: target.legacyFile,
          diagnostics: [
            issue(
              "MIGRATION_INCOMPLETE",
              "transaction",
              `An interrupted migration is pending for ${target.contractId}. Run "contract migrate --recover" first.`,
            ),
          ],
        })),
        [],
        options.projectRoot,
      );
    }

    const [legacyInspection, authoredInspection] = await Promise.all([
      inspectLegacyContracts(policy),
      inspectAuthoredContracts(policy),
    ]);
    const authoredIds = new Set(authoredInspection.contracts.map((entry) => entry.contract.id));
    const inputMap = loadMigrationInputMap(project.root, options.map);
    const requestedIds =
      options.contract && options.contract.length > 0 ? new Set(options.contract) : undefined;

    const globalDiagnostics: Diagnostic[] = legacyInspection.invalid.map((entry) =>
      issue(entry.code, "discovery", entry.message),
    );
    if (requestedIds) {
      const discoveredIds = new Set(legacyInspection.legacy.map((entry) => entry.contract.id));
      for (const requested of requestedIds) {
        if (!discoveredIds.has(requested)) {
          globalDiagnostics.push(
            issue(
              "MIGRATION_CONTRACT_NOT_FOUND",
              "discovery",
              `No legacy contract with id ${JSON.stringify(requested)} was discovered.`,
            ),
          );
        }
      }
    }

    const candidates = legacyInspection.legacy.filter(
      (entry) => !requestedIds || requestedIds.has(entry.contract.id),
    );

    const legacySiblingIds = new Map<string, Set<string>>();
    for (const entry of legacyInspection.legacy) {
      const set = legacySiblingIds.get(entry.file) ?? new Set<string>();
      set.add(entry.contract.id);
      legacySiblingIds.set(entry.file, set);
    }

    const plans: ResolvedMigrationPlan[] = [];
    const unresolved: ContractMigrateUnresolvedEntry[] = [];
    for (const candidate of candidates) {
      if (authoredIds.has(candidate.contract.id)) {
        unresolved.push({
          contractId: candidate.contract.id,
          legacyFile: candidate.file,
          diagnostics: [
            issue(
              "MIGRATION_ID_CONFLICT",
              "resolution",
              `${candidate.contract.id} already has an authored contract; migration never overwrites an existing authored ID.`,
            ),
          ],
        });
        continue;
      }
      const resolution = await resolveOneContract(
        candidate,
        inputMap[candidate.contract.id],
        policy,
        project.root,
        prompts,
        dryRun,
      );
      if (!resolution.plan) {
        unresolved.push({
          contractId: candidate.contract.id,
          legacyFile: candidate.file,
          diagnostics: resolution.blockers,
        });
        continue;
      }
      plans.push(resolution.plan);
    }

    const blocked = unresolved.length > 0 || globalDiagnostics.length > 0;

    if (dryRun) {
      const previewed: ContractMigratedEntry[] = plans.map((plan) => ({
        contractId: plan.candidate.contract.id,
        legacyFile: plan.candidate.file,
        path: portablePath(project.root, newFileFor(project.root, plan.candidate.contract.id)),
        ...(plan.snapshotDigest === PENDING_REFRESH_SNAPSHOT_DIGEST
          ? {}
          : { snapshotDigest: plan.snapshotDigest }),
        ...(plan.removedOrigin ? { removedOrigin: plan.removedOrigin } : {}),
        diagnostics: plan.infoDiagnostics,
      }));
      prompts.outro(
        blocked ? "Blockers found; nothing was written." : "Preview complete; nothing was written.",
      );
      return buildOutcome(true, previewed, unresolved, globalDiagnostics, options.projectRoot);
    }

    if (blocked) {
      prompts.outro("Blockers found; write mode changed nothing.");
      return buildOutcome(false, [], unresolved, globalDiagnostics, options.projectRoot);
    }

    if (plans.length === 0) {
      prompts.outro("No legacy contracts to migrate.");
      return buildOutcome(false, [], [], [], options.projectRoot);
    }

    const migrated = await executeMigration(
      project.root,
      policy,
      plans,
      legacySiblingIds,
      runtime,
      dependencies,
    );
    prompts.outro(`Migrated ${migrated.length} contract(s).`);
    return buildOutcome(false, migrated, [], [], options.projectRoot);
  } catch (error) {
    prompts.cancel("Migration failed.");
    return errorOutcome(error, dryRun);
  }
}
