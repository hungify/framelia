import * as fs from "node:fs";
import * as path from "node:path";

import { parse as parseDotenv } from "dotenv";

import { AppError } from "./types.ts";

const DEFAULT_ENV_FILES = [".env", ".env.local"] as const;

export interface LoadProjectEnvOptions {
  files?: string[];
  /** Where parsed keys land; defaults to this process's own environment. */
  env?: NodeJS.ProcessEnv;
}

export interface EnvFileSpec {
  name: string;
  required: boolean;
}

export function loadProjectEnv(
  projectRoot: string = process.cwd(),
  options?: LoadProjectEnvOptions,
): string[] {
  return loadEnvFileSequence(
    projectRoot,
    (options?.files ?? [...DEFAULT_ENV_FILES]).map((name) => ({ name, required: false })),
    options?.env ? { env: options.env } : undefined,
  );
}

/**
 * Rejects absolute paths, `..` traversal, and paths that resolve outside
 * `root` — the one owner of "is this project-relative path safe", so
 * every caller (env files, framelia.config paths) gets the same guarantee
 * instead of each re-implementing a slightly different subset of it.
 */
export function assertProjectRelativePath(root: string, value: string, label: string): void {
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    throw new AppError(
      "INVALID_PROJECT_RELATIVE_PATH",
      `${label} must be project-relative without parent traversal.`,
    );
  }
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new AppError("PATH_ESCAPES_PROJECT_ROOT", `${label} escapes project root: ${value}`);
  }
}

export function loadEnvFiles(
  projectRoot: string,
  envFile: string | string[],
  options?: { required?: boolean; env?: NodeJS.ProcessEnv },
): string[] {
  const names = Array.isArray(envFile) ? envFile : [envFile];
  const required = options?.required ?? true;
  return loadEnvFileSequence(
    projectRoot,
    names.map((name) => ({ name, required })),
    options?.env ? { env: options.env } : undefined,
  );
}

export function loadEnvFileSequence(
  projectRoot: string,
  files: readonly EnvFileSpec[],
  options?: { env?: NodeJS.ProcessEnv },
): string[] {
  const root = path.resolve(projectRoot);
  const env = options?.env ?? process.env;
  const processKeys = new Set(Object.keys(env));
  const loaded: string[] = [];

  for (const { name, required } of files) {
    if (!name.trim())
      throw new AppError("ENV_FILE_ENTRY_INVALID", "envFile entries must be non-empty strings.");
    assertProjectRelativePath(root, name, "envFile");
    const file = path.resolve(root, name);
    if (!fs.existsSync(file)) {
      if (required) throw new AppError("ENV_FILE_NOT_FOUND", `envFile not found: ${name}`);
      continue;
    }
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(file);
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) {
      throw new AppError("PATH_ESCAPES_PROJECT_ROOT", `envFile escapes project root: ${name}`);
    }
    applyEnvFile(file, env, processKeys);
    loaded.push(file);
  }
  return loaded;
}

/**
 * Parse-only: `dotenv.parse(text)` is a pure string-to-object function with
 * no side effects on `process.env`. Keys present before the sequence began
 * remain authoritative; for every other key, later files replace earlier
 * file values.
 */
function applyEnvFile(
  file: string,
  env: NodeJS.ProcessEnv,
  processKeys: ReadonlySet<string>,
): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const parsed = parseDotenv(text);
  for (const [key, val] of Object.entries(parsed)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (processKeys.has(key)) continue;
    env[key] = val;
  }
}
