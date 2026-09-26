import * as path from "node:path";

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
        throw new UsageError(error instanceof Error ? error.message : String(error));
      });
      return configPromise;
    },
  };
}
