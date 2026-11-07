import * as path from "node:path";

import { AppError } from "@framelia/verify";
import { discoverProjectConfig, resolveProjectPolicy } from "@framelia/verify/project-policy";
import type { ResolvedProjectPolicy } from "@framelia/verify/project-policy";

import { UsageError } from "../exit.ts";
import type { CliRuntime } from "../runtime-types.ts";

export interface Project {
  readonly root: string;
  readonly resolve: (relativePath: string) => string;
  readonly loadConfig: () => Promise<ResolvedProjectPolicy>;
}

export function openProject(rawRoot: string | undefined, runtime: CliRuntime): Project {
  const cwd = runtime.cwd();
  const discovered = discoverProjectConfig(cwd, rawRoot);
  const root = discovered.root;
  let configPromise: Promise<ResolvedProjectPolicy> | undefined;

  return {
    root,
    resolve: (relativePath) => path.resolve(root, relativePath),
    loadConfig() {
      configPromise ??= resolveProjectPolicy({
        cwd,
        ...(rawRoot ? { projectRoot: rawRoot } : {}),
        env: runtime.env,
      }).catch((error: unknown) => {
        // Keep the policy's own code (e.g. INVALID_PROJECT_CONFIG) for structured outcomes.
        if (error instanceof AppError) throw error;
        throw new UsageError(error instanceof Error ? error.message : String(error), {
          code: "INVALID_PROJECT_CONFIG",
          cause: error,
        });
      });
      return configPromise;
    },
  };
}
