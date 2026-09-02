import * as fs from "node:fs";
import * as path from "node:path";

import { parse as parseDotenv } from "dotenv";

import { AppError } from "./types.ts";

const DEFAULT_ENV_FILES = [".env.local", ".env"] as const;

export interface LoadProjectEnvOptions {
  files?: string[];
}

export function loadProjectEnv(
  projectRoot: string = process.cwd(),
  options?: LoadProjectEnvOptions,
): string[] {
  return loadEnvFiles(projectRoot, options?.files ?? [...DEFAULT_ENV_FILES], { required: false });
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
  options?: { required?: boolean },
): string[] {
  const root = path.resolve(projectRoot);
  const names = Array.isArray(envFile) ? envFile : [envFile];
  const required = options?.required ?? true;
  const loaded: string[] = [];

  for (const name of names) {
    if (!name.trim())
      throw new AppError("ENV_FILE_ENTRY_INVALID", "envFile entries must be non-empty strings.");
    assertProjectRelativePath(root, name, "envFile");
    const file = path.resolve(root, name);
    if (!fs.existsSync(file)) {
      if (required) throw new AppError("ENV_FILE_NOT_FOUND", `envFile not found: ${name}`);
      continue;
    }
    // path.resolve doesn't follow symlinks; realpath before trusting the file
    // stays under root, so a symlinked envFile can't read files outside it.
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(file);
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) {
      throw new AppError("PATH_ESCAPES_PROJECT_ROOT", `envFile escapes project root: ${name}`);
    }
    applyEnvFile(file);
    loaded.push(file);
  }
  return loaded;
}

/**
 * Parse-only: `dotenv.parse(text)` is a pure string-to-object function with
 * no side effects on `process.env` -- never `dotenv.config()`, which reads
 * a file and writes process.env itself, bypassing this module's own
 * key-name filter and "don't overwrite an already-set key" precedence.
 */
function applyEnvFile(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  const parsed = parseDotenv(text);
  for (const [key, val] of Object.entries(parsed)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = val;
  }
}
