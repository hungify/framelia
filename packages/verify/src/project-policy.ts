import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import {
  captureDefaultsSchema,
  verificationContractSchema,
  verificationRequestSchema,
  webTargetSchema,
  type CaptureDefaults,
  type VerificationContract,
  type WebTarget,
} from "@framelia/contracts";
import { authoredContractSchema, type AuthoredContract } from "@framelia/contracts/workflow";
import { glob } from "tinyglobby";
import { require as tsxRequire } from "tsx/cjs/api";
import { tsImport } from "tsx/esm/api";
import * as z from "zod";

import { canonicalJson, canonicalJsonDigest, type CanonicalJsonValue } from "./canonical-json.ts";
import { sha256Hex } from "./hash.ts";
import { assertProjectRelativePath, loadEnvFileSequence } from "./load-env.ts";
import { assertNoPendingMigrationTransaction } from "./migration.ts";
import { AppError } from "./types.ts";

// Re-exported so a caller resolving a project's config path (e.g. via
// `discoverProjectConfig`) can hash that same file's raw bytes for a synchronous,
// race-free identity check -- see `reconcile.ts`'s own `fileHash(specFilePath)` use for
// the same pattern applied to a spec file.
export { fileHash } from "./hash.ts";

export const CONFIG_FILE_NAMES = [
  "framelia.config.ts",
  "framelia.config.mts",
  "framelia.config.js",
  "framelia.config.mjs",
] as const;

export type RetryAcceptancePolicy = "require-first-attempt" | "allow-passed-after-retry";

export interface FrameliaProjectConfig extends CaptureDefaults {
  storageStatePath?: string;
  envFile?: string | string[];
  playwright?: {
    config: string;
    projects: string[];
  };
  contracts?: string[];
  retryAcceptance?: RetryAcceptancePolicy;
}

export interface ResolvedProjectPolicy {
  root: string;
  configPath?: string;
  configFile?: string;
  initialized: boolean;
  playwright?: {
    config: string;
    configPath: string;
    projects: string[];
  };
  contracts?: {
    patterns: string[];
    roots: string[];
  };
  envFiles: string[];
  loadedEnvFiles: string[];
  capture: CaptureDefaults;
  retryAcceptance: RetryAcceptancePolicy;
  storageStatePath?: string;
  resolvedStorageStatePath?: string;
  policyDigest?: `sha256:${string}`;
}

export interface ResolveProjectPolicyOptions {
  cwd?: string;
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  allowUninitialized?: boolean;
}

const CONTRACT_DEFAULT_KEYS = captureDefaultsSchema.keyof().options;
const KNOWN_KEYS = new Set<string>([
  "storageStatePath",
  "envFile",
  "playwright",
  "contracts",
  "retryAcceptance",
  ...CONTRACT_DEFAULT_KEYS,
]);
const SCREEN_SPECIFIC_KEYS = new Set([
  "target",
  "route",
  "baseline",
  "figma",
  "fileKey",
  "nodeId",
  "viewport",
  "scope",
  "readySelector",
  "readyEvent",
  "masks",
  "navigation",
]);

const playwrightPolicySchema = z
  .object({
    config: z.string().trim().min(1),
    projects: z.array(z.string()).min(1),
  })
  .strict()
  .superRefine((policy, context) => {
    const seen = new Set<string>();
    policy.projects.forEach((project, index) => {
      if (seen.has(project)) {
        context.addIssue({
          code: "custom",
          path: ["projects", index],
          message: `duplicate Playwright project name: ${JSON.stringify(project)}`,
        });
      }
      seen.add(project);
    });
  });

const contractPatternsSchema = z
  .array(z.string().trim().min(1))
  .min(1)
  .superRefine((patterns, context) => {
    const seen = new Set<string>();
    patterns.forEach((pattern, index) => {
      if (seen.has(pattern)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: `duplicate pattern: ${pattern}`,
        });
      }
      seen.add(pattern);
    });
  });

export function defineProjectConfig(config: FrameliaProjectConfig): FrameliaProjectConfig {
  return config;
}

export function findConfigFiles(root: string): string[] {
  return CONFIG_FILE_NAMES.map((name) => path.join(root, name)).filter((filePath) =>
    fs.existsSync(filePath),
  );
}

export function assertSingleConfigFile(matches: string[]): void {
  if (matches.length > 1) {
    throw new AppError(
      "MULTIPLE_PROJECT_CONFIGS",
      `Multiple Framelia config files found: ${matches.join(", ")}. Keep exactly one.`,
    );
  }
}

function parentDirectory(directory: string): string | undefined {
  const parent = path.dirname(directory);
  return parent === directory ? undefined : parent;
}

function enclosingGitRoot(start: string): string | undefined {
  let directory: string | undefined = start;
  while (directory) {
    if (fs.existsSync(path.join(directory, ".git"))) return directory;
    directory = parentDirectory(directory);
  }
  return undefined;
}

export function discoverProjectConfig(
  cwd: string,
  explicitProjectRoot?: string,
): { root: string; configPath?: string } {
  const start = path.resolve(cwd, explicitProjectRoot ?? ".");
  if (explicitProjectRoot) {
    const matches = findConfigFiles(start);
    assertSingleConfigFile(matches);
    return { root: start, ...(matches[0] ? { configPath: matches[0] } : {}) };
  }

  const gitRoot = enclosingGitRoot(start);
  let directory: string | undefined = start;
  while (directory) {
    const matches = findConfigFiles(directory);
    assertSingleConfigFile(matches);
    if (matches[0]) return { root: directory, configPath: matches[0] };
    if (directory === gitRoot) break;
    directory = parentDirectory(directory);
  }
  return { root: start };
}

function normalizeEnvFiles(value: unknown, root: string): string[] {
  if (value == null) return [];
  const files = typeof value === "string" ? [value] : value;
  if (!Array.isArray(files) || files.length === 0) {
    throw new AppError(
      "INVALID_PROJECT_CONFIG",
      "framelia.config envFile must be a string or non-empty string array.",
    );
  }
  for (const entry of files) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new AppError(
        "INVALID_PROJECT_CONFIG",
        "framelia.config envFile entries must be non-empty strings.",
      );
    }
    assertProjectRelativePath(root, entry, "framelia.config envFile");
  }
  return files as string[];
}

function normalizeCaptureDefaults(config: Record<string, unknown>): CaptureDefaults {
  const present = Object.fromEntries(
    CONTRACT_DEFAULT_KEYS.filter((key) => config[key] !== undefined).map((key) => [
      key,
      config[key],
    ]),
  );
  const result = captureDefaultsSchema.safeParse(present);
  if (!result.success) {
    throw new AppError(
      "INVALID_PROJECT_CONFIG",
      `framelia.config: ${result.error.issues
        .map((issue) =>
          issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
        )
        .join("; ")}`,
    );
  }
  return result.data;
}

function discoveryRoot(pattern: string): string {
  const wildcard = pattern.search(/[*?[\]{}!]/);
  if (wildcard < 0) return path.dirname(pattern) || ".";
  const stablePrefix = pattern.slice(0, wildcard);
  const separator = Math.max(stablePrefix.lastIndexOf("/"), stablePrefix.lastIndexOf("\\"));
  return separator < 0 ? "." : stablePrefix.slice(0, separator) || ".";
}

function nearestPackageModuleType(startDirectory: string): "module" | "commonjs" {
  let dir = startDirectory;
  for (;;) {
    const packageJsonPath = path.join(dir, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
          type?: unknown;
        };
        return manifest.type === "module" ? "module" : "commonjs";
      } catch {
        return "commonjs";
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return "commonjs";
    dir = parent;
  }
}

// `.ts`/`.js` are ambiguous per Node's module resolution: their module type
// follows the nearest `package.json#type`. `.mjs`/`.mts` are always ESM.
// tsx's ESM `tsImport` cannot execute `import` syntax under a CommonJS
// package scope on Node 22, so CommonJS-scoped configs load through tsx's
// CJS `require` instead.
async function importConfigModule(configPath: string): Promise<{ default?: unknown }> {
  const extension = path.extname(configPath);
  const isForcedEsm = extension === ".mjs" || extension === ".mts";
  const moduleType = isForcedEsm ? "module" : nearestPackageModuleType(path.dirname(configPath));

  if (moduleType === "commonjs") {
    const loaded = tsxRequire(configPath, import.meta.url) as { default?: unknown };
    return { default: loaded.default };
  }

  const imported = (await tsImport(pathToFileURL(configPath).href, import.meta.url)) as {
    default?: unknown;
    "module.exports"?: unknown;
  };
  let value = imported.default;
  if (
    value &&
    typeof value === "object" &&
    "default" in value &&
    ("module.exports" in imported || Object.keys(imported).length === 1)
  ) {
    value = value.default;
  }
  return { default: value };
}

export async function resolveProjectPolicy(
  options: ResolveProjectPolicyOptions = {},
): Promise<ResolvedProjectPolicy> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const discovered = discoverProjectConfig(cwd, options.projectRoot);
  if (!discovered.configPath) {
    if (!options.allowUninitialized) {
      throw new AppError(
        "PROJECT_NOT_INITIALIZED",
        `No Framelia config found from ${discovered.root}. Run framelia init or pass --project-root.`,
      );
    }
    return {
      root: discovered.root,
      initialized: false,
      envFiles: [],
      loadedEnvFiles: [],
      capture: {},
      retryAcceptance: "require-first-attempt",
    };
  }

  const imported = await importConfigModule(discovered.configPath);
  const value: unknown = imported.default;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(
      "INVALID_PROJECT_CONFIG",
      `${discovered.configPath} must default-export a Framelia config object.`,
    );
  }

  const config = value as Record<string, unknown>;
  const unknownKeys = Object.keys(config).filter((key) => !KNOWN_KEYS.has(key));
  const screenSpecificKeys = unknownKeys.filter((key) => SCREEN_SPECIFIC_KEYS.has(key));
  if (screenSpecificKeys.length > 0) {
    throw new AppError(
      "INVALID_PROJECT_CONFIG",
      `framelia.config cannot contain screen-specific option${screenSpecificKeys.length > 1 ? "s" : ""}: ${screenSpecificKeys.join(", ")}. Put route, baseline, viewport, and state in a visual-contract.json file.`,
    );
  }
  if (unknownKeys.length > 0) {
    throw new AppError(
      "INVALID_PROJECT_CONFIG",
      `Unknown Framelia config option${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys.join(", ")}.`,
    );
  }

  const root = discovered.root;
  const envFiles = [".env", ".env.local", ...normalizeEnvFiles(config.envFile, root)];
  const loadedAbsolute = loadEnvFileSequence(
    root,
    envFiles.map((name, index) => ({ name, required: index >= 2 })),
    options.env ? { env: options.env } : undefined,
  );
  const loadedEnvFiles = loadedAbsolute.map((file) => path.relative(root, file));
  const capture = normalizeCaptureDefaults(config);

  let playwright: ResolvedProjectPolicy["playwright"];
  if (config.playwright !== undefined) {
    const result = playwrightPolicySchema.safeParse(config.playwright);
    if (!result.success) {
      throw new AppError(
        "INVALID_PROJECT_CONFIG",
        `framelia.config playwright: ${z.prettifyError(result.error)}`,
      );
    }
    assertProjectRelativePath(root, result.data.config, "framelia.config playwright.config");
    playwright = {
      config: result.data.config,
      configPath: path.resolve(root, result.data.config),
      projects: result.data.projects,
    };
  }

  let contracts: ResolvedProjectPolicy["contracts"];
  if (config.contracts !== undefined) {
    const result = contractPatternsSchema.safeParse(config.contracts);
    if (!result.success) {
      throw new AppError(
        "INVALID_PROJECT_CONFIG",
        `framelia.config contracts: ${z.prettifyError(result.error)}`,
      );
    }
    for (const pattern of result.data) {
      assertProjectRelativePath(root, pattern, "framelia.config contracts pattern");
    }
    contracts = {
      patterns: result.data,
      roots: [...new Set(result.data.map(discoveryRoot))],
    };
  }

  const retryAcceptanceResult = z
    .enum(["require-first-attempt", "allow-passed-after-retry"])
    .safeParse(config.retryAcceptance ?? "require-first-attempt");
  if (!retryAcceptanceResult.success) {
    throw new AppError(
      "INVALID_PROJECT_CONFIG",
      `framelia.config retryAcceptance: ${z.prettifyError(retryAcceptanceResult.error)}`,
    );
  }

  const storageStatePath = config.storageStatePath;
  if (
    storageStatePath != null &&
    (typeof storageStatePath !== "string" || !storageStatePath.trim())
  ) {
    throw new AppError(
      "INVALID_PROJECT_CONFIG",
      "framelia.config storageStatePath must be a non-empty string.",
    );
  }
  if (typeof storageStatePath === "string") {
    assertProjectRelativePath(root, storageStatePath, "framelia.config storageStatePath");
  }

  const portablePolicy: CanonicalJsonValue = {
    capture: capture as CanonicalJsonValue,
    contracts: contracts ? { patterns: contracts.patterns, roots: contracts.roots } : null,
    environment: { files: envFiles, loadedFiles: loadedEnvFiles },
    playwright: playwright ? { config: playwright.config, projects: playwright.projects } : null,
    retryAcceptance: retryAcceptanceResult.data,
  };

  return {
    root,
    configPath: discovered.configPath,
    configFile: path.relative(root, discovered.configPath),
    initialized: true,
    ...(playwright ? { playwright } : {}),
    ...(contracts ? { contracts } : {}),
    envFiles,
    loadedEnvFiles,
    capture,
    retryAcceptance: retryAcceptanceResult.data,
    ...(typeof storageStatePath === "string"
      ? {
          storageStatePath,
          resolvedStorageStatePath: path.resolve(root, storageStatePath),
        }
      : {}),
    policyDigest: canonicalJsonDigest(portablePolicy),
  };
}

export interface DiscoveredAuthoredContract {
  file: string;
  digest: `sha256:${string}`;
  contract: AuthoredContract;
}

export interface ContractProjectCase {
  contractId: string;
  contractFile: string;
  contractDigest: `sha256:${string}`;
  project: string;
  required: boolean;
}

export interface ContractProjectMatrix {
  allCases: ContractProjectCase[];
  requiredCases: ContractProjectCase[];
}

export interface InvalidAuthoredContract {
  file: string;
  code: "CONTRACT_FILE_INVALID" | "DUPLICATE_CONTRACT_ID";
  message: string;
  contractId?: string;
}

export interface AuthoredContractInspection {
  contracts: DiscoveredAuthoredContract[];
  invalid: InvalidAuthoredContract[];
}

interface ContractFileWalkEntry {
  portableFile: string;
  realPath: string;
}

interface ContractFileWalkInvalid {
  file: string;
  code: "CONTRACT_FILE_INVALID";
  message: string;
}

/** Shared glob-match, sort, and project-root-escape check every contract discovery
 *  walk (authored or legacy) needs; format-specific JSON parsing stays with each caller. */
async function walkContractFiles(policy: ResolvedProjectPolicy): Promise<{
  entries: ContractFileWalkEntry[];
  invalid: ContractFileWalkInvalid[];
}> {
  const matched = new Set(
    await glob(policy.contracts!.patterns, {
      cwd: policy.root,
      dot: true,
      onlyFiles: true,
    }),
  );
  const realRoot = fs.realpathSync(policy.root);
  const entries: ContractFileWalkEntry[] = [];
  const invalid: ContractFileWalkInvalid[] = [];
  for (const file of [...matched].toSorted()) {
    const portableFile = file.split(path.sep).join("/");
    const absolutePath = path.resolve(policy.root, file);
    let realPath: string;
    try {
      realPath = fs.realpathSync(absolutePath);
    } catch (error) {
      invalid.push({
        file: portableFile,
        code: "CONTRACT_FILE_INVALID",
        message: `Cannot read contract ${portableFile}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) {
      invalid.push({
        file: portableFile,
        code: "CONTRACT_FILE_INVALID",
        message: `Contract path escapes project root: ${portableFile}`,
      });
      continue;
    }
    entries.push({ portableFile, realPath });
  }
  return { entries, invalid };
}

/**
 * Uses the same roots, parser and global-ID rules as execution discovery, but retains
 * every malformed/duplicate file so `contract list` can report the whole repair set.
 * Refuses to trust any contract state while a `contract migrate` transaction is pending
 * -- an interrupted multi-file migration must never look like a valid, complete set.
 */
export async function inspectAuthoredContracts(
  policy: ResolvedProjectPolicy,
): Promise<AuthoredContractInspection> {
  assertNoPendingMigrationTransaction(policy.root);
  if (!policy.contracts) {
    throw new AppError(
      "PROJECT_POLICY_INCOMPLETE",
      "framelia.config must declare at least one contract discovery pattern.",
    );
  }

  const walked = await walkContractFiles(policy);
  const contracts: DiscoveredAuthoredContract[] = [];
  const invalid: InvalidAuthoredContract[] = [...walked.invalid];
  const idOwners = new Map<
    string,
    { file: string; entry: DiscoveredAuthoredContract; alreadyInvalid: boolean }
  >();
  for (const { portableFile, realPath } of walked.entries) {
    let input: unknown;
    try {
      input = JSON.parse(fs.readFileSync(realPath, "utf8")) as unknown;
    } catch (error) {
      invalid.push({
        file: portableFile,
        code: "CONTRACT_FILE_INVALID",
        message: `Cannot read contract ${portableFile}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const result = authoredContractSchema.safeParse(input);
    if (!result.success) {
      invalid.push({
        file: portableFile,
        code: "CONTRACT_FILE_INVALID",
        message: `Invalid contract ${portableFile}: ${z.prettifyError(result.error)}`,
      });
      continue;
    }

    const entry = {
      file: portableFile,
      digest: canonicalJsonDigest(result.data as CanonicalJsonValue),
      contract: result.data,
    };
    const previousOwner = idOwners.get(result.data.id);
    if (previousOwner) {
      const message = `Duplicate contract id ${result.data.id}: ${previousOwner.file}, ${portableFile}`;
      if (!previousOwner.alreadyInvalid) {
        const previousIndex = contracts.indexOf(previousOwner.entry);
        if (previousIndex !== -1) contracts.splice(previousIndex, 1);
        invalid.push({
          file: previousOwner.file,
          code: "DUPLICATE_CONTRACT_ID",
          contractId: result.data.id,
          message,
        });
        previousOwner.alreadyInvalid = true;
      }
      invalid.push({
        file: portableFile,
        code: "DUPLICATE_CONTRACT_ID",
        contractId: result.data.id,
        message,
      });
      continue;
    }
    idOwners.set(result.data.id, { file: portableFile, entry, alreadyInvalid: false });
    contracts.push(entry);
  }
  return { contracts, invalid };
}

export interface LegacyContractCandidate {
  /** Legacy request file, portable and relative to the project root. */
  file: string;
  /** `sha256:<hex>` digest of the legacy file's raw bytes, for the migration CAS check. */
  fileDigest: `sha256:${string}`;
  /** Request-level target shared by every contract entry in this legacy file. Undefined
   *  when the file's own `target` is missing or invalid but its `contracts` entries still
   *  validate individually -- migration must still surface those ids with route unresolved
   *  rather than dropping the whole file as opaque. */
  target: WebTarget | undefined;
  contract: VerificationContract;
  /** How many contract entries this legacy file holds in total -- migrating the last
   *  remaining entry deletes the file outright rather than rewriting an empty array. */
  siblingCount: number;
}

export interface InvalidLegacyContract {
  file: string;
  code: "CONTRACT_FILE_INVALID" | "DUPLICATE_CONTRACT_ID";
  message: string;
  contractId?: string;
}

export interface LegacyContractInspection {
  legacy: LegacyContractCandidate[];
  invalid: InvalidLegacyContract[];
}

/**
 * Walks the same configured discovery roots as `inspectAuthoredContracts`, but for the
 * pre-authored-contract `verificationRequestSchema` shape `contract migrate` converts
 * from. A file already in the current authored shape is silently skipped (not a
 * migration candidate, not invalid); a file matching neither schema is reported invalid
 * so `contract migrate` can surface it as a blocker instead of silently ignoring it.
 *
 * A file whose own request-level `target` is missing/invalid, but whose individual
 * `contracts[]` entries still validate against `verificationContractSchema`, is still
 * recovered leniently -- with `target: undefined` -- rather than dropped wholesale: a
 * broken/absent legacy route is exactly the "missing route" case `contract migrate` must
 * report per contract id, not a reason to hide that id from migration entirely.
 */
export async function inspectLegacyContracts(
  policy: ResolvedProjectPolicy,
): Promise<LegacyContractInspection> {
  if (!policy.contracts) {
    throw new AppError(
      "PROJECT_POLICY_INCOMPLETE",
      "framelia.config must declare at least one contract discovery pattern.",
    );
  }

  const walked = await walkContractFiles(policy);
  const legacy: LegacyContractCandidate[] = [];
  const invalid: InvalidLegacyContract[] = [...walked.invalid];
  const idOwners = new Map<string, { file: string; alreadyInvalid: boolean }>();
  for (const { portableFile, realPath } of walked.entries) {
    let raw: Buffer;
    try {
      raw = fs.readFileSync(realPath);
    } catch (error) {
      invalid.push({
        file: portableFile,
        code: "CONTRACT_FILE_INVALID",
        message: `Cannot read contract ${portableFile}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    let input: unknown;
    try {
      input = JSON.parse(raw.toString("utf8")) as unknown;
    } catch (error) {
      invalid.push({
        file: portableFile,
        code: "CONTRACT_FILE_INVALID",
        message: `Cannot read contract ${portableFile}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    // Already migrated -- not a legacy candidate, and not an error either.
    if (authoredContractSchema.safeParse(input).success) continue;

    const fileDigest = `sha256:${sha256Hex(raw)}` as const;
    const fullResult = verificationRequestSchema.safeParse(input);
    let recoveredTarget: WebTarget | undefined;
    let recoveredContracts: VerificationContract[] | undefined;
    if (fullResult.success) {
      recoveredTarget = fullResult.data.target;
      recoveredContracts = fullResult.data.contracts;
    } else if (typeof input === "object" && input !== null && "contracts" in input) {
      const rawContractsField = input.contracts;
      if (Array.isArray(rawContractsField)) {
        const targetField = "target" in input ? input.target : undefined;
        const targetResult = webTargetSchema.safeParse(targetField);
        const parseResults = rawContractsField.map((rawContract: unknown) =>
          verificationContractSchema.safeParse(rawContract),
        );
        const parsedContracts = parseResults
          .filter((parsedContract) => parsedContract.success)
          .map((parsedContract) => parsedContract.data);
        if (parsedContracts.length > 0) {
          recoveredTarget = targetResult.success ? targetResult.data : undefined;
          recoveredContracts = parsedContracts;
          // Some entries parsed and some didn't -- the parsed ones are still safe to
          // migrate, but the file can never be deleted out from under the entries that
          // failed to parse. Report each dropped entry as a global blocker (matching
          // every other invalid-legacy-file case below) so dry-run surfaces it and write
          // mode changes nothing until the file is fixed, rather than silently deleting
          // an entry nothing ever migrated.
          parseResults.forEach((parsedContract, index) => {
            if (parsedContract.success) return;
            const rawEntry = rawContractsField[index];
            const rawId =
              typeof rawEntry === "object" &&
              rawEntry !== null &&
              typeof (rawEntry as Record<string, unknown>).id === "string"
                ? ((rawEntry as Record<string, unknown>).id as string)
                : undefined;
            invalid.push({
              file: portableFile,
              code: "CONTRACT_FILE_INVALID",
              ...(rawId ? { contractId: rawId } : {}),
              message: `${portableFile}: contracts[${index}]${rawId ? ` (${rawId})` : ""} is not a valid legacy contract entry and cannot be safely migrated or silently discarded: ${z.prettifyError(parsedContract.error)}`,
            });
          });
        }
      }
    }

    if (!recoveredContracts) {
      invalid.push({
        file: portableFile,
        code: "CONTRACT_FILE_INVALID",
        message: `${portableFile} is neither an authored contract nor a legacy verification request: ${z.prettifyError(fullResult.error!)}`,
      });
      continue;
    }

    for (const contract of recoveredContracts) {
      const previousOwner = idOwners.get(contract.id);
      if (previousOwner) {
        const message = `Duplicate legacy contract id ${contract.id}: ${previousOwner.file}, ${portableFile}`;
        if (!previousOwner.alreadyInvalid) {
          const previousIndex = legacy.findIndex((entry) => entry.contract.id === contract.id);
          if (previousIndex !== -1) legacy.splice(previousIndex, 1);
          invalid.push({
            file: previousOwner.file,
            code: "DUPLICATE_CONTRACT_ID",
            contractId: contract.id,
            message,
          });
          previousOwner.alreadyInvalid = true;
        }
        invalid.push({
          file: portableFile,
          code: "DUPLICATE_CONTRACT_ID",
          contractId: contract.id,
          message,
        });
        continue;
      }
      idOwners.set(contract.id, { file: portableFile, alreadyInvalid: false });
      legacy.push({
        file: portableFile,
        fileDigest,
        target: recoveredTarget,
        contract,
        siblingCount: recoveredContracts.length,
      });
    }
  }
  return { legacy, invalid };
}

export async function discoverAuthoredContracts(
  policy: ResolvedProjectPolicy,
): Promise<DiscoveredAuthoredContract[]> {
  const inspected = await inspectAuthoredContracts(policy);
  const firstInvalid = inspected.invalid[0];
  if (firstInvalid) throw new AppError(firstInvalid.code, firstInvalid.message);
  return inspected.contracts;
}

export function resolveContractProjectMatrix(
  policy: ResolvedProjectPolicy,
  contracts: readonly DiscoveredAuthoredContract[],
): ContractProjectMatrix {
  if (!policy.playwright) {
    throw new AppError(
      "PROJECT_POLICY_INCOMPLETE",
      "framelia.config must declare Playwright config and visual project names.",
    );
  }

  const configuredProjects = new Set(policy.playwright.projects);
  const allCases: ContractProjectCase[] = [];
  for (const entry of contracts) {
    const projects = entry.contract.projects ?? policy.playwright.projects;
    for (const project of projects) {
      if (!configuredProjects.has(project)) {
        throw new AppError(
          "UNKNOWN_PLAYWRIGHT_PROJECT",
          `Contract ${entry.contract.id} requires unknown Playwright project ${JSON.stringify(project)}.`,
        );
      }
      allCases.push({
        contractId: entry.contract.id,
        contractFile: entry.file,
        contractDigest: entry.digest,
        project,
        required: entry.contract.required,
      });
    }
  }

  return {
    allCases,
    requiredCases: allCases.filter((entry) => entry.required),
  };
}

export { canonicalJson, canonicalJsonDigest };
export type { CanonicalJsonValue };
