import { defineProjectConfig, resolveProjectPolicy } from "@framelia/verify/project-policy";
import type { FrameliaProjectConfig, ResolvedProjectPolicy } from "@framelia/verify/project-policy";

export type FrameliaConfig = FrameliaProjectConfig;
export type ResolvedFrameliaConfig = ResolvedProjectPolicy;

export {
  assertSingleConfigFile,
  CONFIG_FILE_NAMES,
  findConfigFiles,
} from "@framelia/verify/project-policy";

export function defineConfig(config: FrameliaConfig): FrameliaConfig {
  return defineProjectConfig(config);
}

export function loadFrameliaConfig(
  projectRoot: string,
  options?: { env?: NodeJS.ProcessEnv },
): Promise<ResolvedFrameliaConfig> {
  return resolveProjectPolicy({
    cwd: projectRoot,
    projectRoot,
    ...(options?.env ? { env: options.env } : {}),
  });
}
