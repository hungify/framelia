import * as fs from "node:fs";
import * as path from "node:path";

/** Parses a JSON file. `filePath` may be relative -- it resolves against `cwd`
 * (the injected `CliRuntime.cwd()`, never global `process.cwd()`) before reading,
 * but a read/parse failure reports the *original* `filePath` in its message,
 * matching the old CLI's diagnostic exactly. */
export function readJsonFile(filePath: string, cwd: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(cwd, filePath), "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read JSON ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
