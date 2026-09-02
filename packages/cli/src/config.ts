import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { captureDefaultsSchema, type CaptureDefaults } from "@framelia/contracts";
import { assertProjectRelativePath, loadEnvFiles } from "@framelia/verify";

export interface FrameliaConfig extends CaptureDefaults {
  storageStatePath?: string;
  envFile?: string | string[];
}

export interface ResolvedFrameliaConfig extends FrameliaConfig {
  configPath?: string;
  resolvedStorageStatePath?: string;
}

/** Canonical config filenames — the one place this list is declared. */
export const CONFIG_FILE_NAMES = [
  "framelia.config.ts",
  "framelia.config.mts",
  "framelia.config.js",
  "framelia.config.mjs",
] as const;

export function findConfigFiles(root: string): string[] {
  return CONFIG_FILE_NAMES.map((name) => path.join(root, name)).filter((filePath) =>
    fs.existsSync(filePath),
  );
}

export function assertSingleConfigFile(matches: string[]): void {
  if (matches.length > 1) {
    throw new Error(
      `Multiple Framelia config files found: ${matches.join(", ")}. Keep exactly one.`,
    );
  }
}

/** Derived from the schema, not hand-listed — stays in sync with CaptureDefaults by construction. */
const CONTRACT_DEFAULT_KEYS = captureDefaultsSchema.keyof().options;

const KNOWN_KEYS = new Set<string>(["storageStatePath", "envFile", ...CONTRACT_DEFAULT_KEYS]);
// Still screen-specific — belongs in visual-contract.json, never framelia.config.
// Hand-maintained, not derived: these names span the request/contract/baseline
// schemas plus capture options that aren't unified under one Zod object (see
// verify/capture/types.ts's ReadyCaptureSpec doc comment), so there's no single
// schema to call .keyof() on the way CONTRACT_DEFAULT_KEYS does above. Keep this
// list in sync by hand when the visual-contract.json shape changes.
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

export function defineConfig(config: FrameliaConfig): FrameliaConfig {
  return config;
}

function normalizeEnvFile(value: unknown, root: string): string | string[] | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    if (!value.trim()) throw new Error("framelia.config envFile must be a non-empty string.");
    assertProjectRelativePath(root, value, "framelia.config envFile");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) throw new Error("framelia.config envFile must not be an empty array.");
    for (const entry of value) {
      if (typeof entry !== "string" || !entry.trim()) {
        throw new Error("framelia.config envFile array entries must be non-empty strings.");
      }
      assertProjectRelativePath(root, entry, "framelia.config envFile");
    }
    return value as string[];
  }
  throw new Error("framelia.config envFile must be a string or string array.");
}

function normalizeContractDefaults(config: Record<string, unknown>): CaptureDefaults {
  const present = Object.fromEntries(
    CONTRACT_DEFAULT_KEYS.filter((key) => config[key] !== undefined).map((key) => [
      key,
      config[key],
    ]),
  );
  const result = captureDefaultsSchema.safeParse(present);
  if (!result.success) {
    throw new Error(
      `framelia.config: ${result.error.issues
        .map((issue) =>
          issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
        )
        .join("; ")}`,
    );
  }
  return result.data;
}

export async function loadFrameliaConfig(projectRoot: string): Promise<ResolvedFrameliaConfig> {
  const root = path.resolve(projectRoot);
  const matches = findConfigFiles(root);
  if (matches.length === 0) return {};
  assertSingleConfigFile(matches);

  const configPath = matches[0]!;
  const imported = await import(pathToFileURL(configPath).href);
  const value: unknown = imported.default;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${configPath} must default-export a Framelia config object.`);
  }

  const config = value as Record<string, unknown>;
  const unknownKeys = Object.keys(config).filter((key) => !KNOWN_KEYS.has(key));
  const screenSpecificKeys = unknownKeys.filter((key) => SCREEN_SPECIFIC_KEYS.has(key));
  if (screenSpecificKeys.length) {
    throw new Error(
      `framelia.config cannot contain screen-specific option${screenSpecificKeys.length > 1 ? "s" : ""}: ${screenSpecificKeys.join(", ")}. ` +
        "Put route, baseline, viewport, and state in a visual-contract.json file.",
    );
  }
  if (unknownKeys.length) {
    throw new Error(
      `Unknown Framelia config option${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys.join(", ")}.`,
    );
  }

  const envFile = normalizeEnvFile(config.envFile, root);
  if (envFile) loadEnvFiles(root, envFile);
  const defaults = normalizeContractDefaults(config);

  const storageStatePath = config.storageStatePath;
  if (
    storageStatePath != null &&
    (typeof storageStatePath !== "string" || !storageStatePath.trim())
  ) {
    throw new Error("framelia.config storageStatePath must be a non-empty string.");
  }

  const resolved: ResolvedFrameliaConfig = { configPath, ...defaults };
  if (envFile) resolved.envFile = envFile;
  if (typeof storageStatePath === "string") {
    assertProjectRelativePath(root, storageStatePath, "framelia.config storageStatePath");
    resolved.storageStatePath = storageStatePath;
    resolved.resolvedStorageStatePath = path.resolve(root, storageStatePath);
  }
  return resolved;
}
