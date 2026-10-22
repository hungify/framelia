import * as fs from "node:fs";

import type { CliRuntime } from "../runtime-types.ts";
import { targetUrlMessage } from "./browser-input.ts";
import { openProject } from "./project.ts";

/**
 * The storage state a standalone browser command uses: the explicit `--storage-state`, else
 * the project's configured `storageStatePath` once `framelia auth` has recorded it.
 *
 * The default is only applied where a session may travel (https, or http on loopback), so a
 * plain-http scan keeps working without silently carrying the session. A project without a
 * readable config simply has no default; these commands do not otherwise need one.
 */
export async function resolveStorageState(
  explicit: string | undefined,
  targetUrl: string,
  projectRoot: string | undefined,
  runtime: CliRuntime,
): Promise<string | undefined> {
  if (explicit !== undefined) return explicit;
  if (targetUrlMessage(targetUrl, "url", { carriesBrowserStorageState: true })) return undefined;
  try {
    const config = await openProject(projectRoot, runtime).loadConfig();
    const configured = config.resolvedStorageStatePath;
    return configured && fs.existsSync(configured) ? configured : undefined;
  } catch {
    return undefined;
  }
}
