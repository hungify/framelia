import * as path from "node:path";

import { loadFrameliaConfig, type ResolvedFrameliaConfig } from "../config.ts";
import { UsageError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";

export interface Project {
  readonly root: string;
  readonly resolve: (relativePath: string) => string;
  readonly loadConfig: () => Promise<ResolvedFrameliaConfig>;
}

export function openProject(rawRoot: string | undefined, runtime: CliRuntime): Project {
  const root = path.resolve(runtime.cwd(), rawRoot ?? ".");
  return {
    root,
    resolve: (relativePath) => path.resolve(root, relativePath),
    async loadConfig() {
      try {
        return await loadFrameliaConfig(root, { env: runtime.env });
      } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error));
      }
    },
  };
}
