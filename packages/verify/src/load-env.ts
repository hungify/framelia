import * as fs from "node:fs";
import * as path from "node:path";

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
    throw new Error(`${label} must be project-relative without parent traversal.`);
  }
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes project root: ${value}`);
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
    if (!name.trim()) throw new Error("envFile entries must be non-empty strings.");
    assertProjectRelativePath(root, name, "envFile");
    const file = path.resolve(root, name);
    if (!fs.existsSync(file)) {
      if (required) throw new Error(`envFile not found: ${name}`);
      continue;
    }
    // path.resolve doesn't follow symlinks; realpath before trusting the file
    // stays under root, so a symlinked envFile can't read files outside it.
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(file);
    if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error(`envFile escapes project root: ${name}`);
    }
    applyEnvFile(file);
    loaded.push(file);
  }
  return loaded;
}

function applyEnvFile(file: string): void {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
