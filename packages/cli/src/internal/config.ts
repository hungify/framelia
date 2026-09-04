import { loadFrameliaConfig, type ResolvedFrameliaConfig } from "../config.ts";
import { UsageError } from "../errors.ts";

/**
 * CLI adapter over the public `loadFrameliaConfig` facade: the library function
 * throws an ordinary `Error` (so non-CLI consumers aren't coupled to CLI exit
 * semantics), and a bad `framelia.config` is a CLI usage mistake, so this is
 * the one place that reclassifies the failure as `UsageError`. Commands that
 * need config (auth, contract create, baseline promote) call this, not
 * `loadFrameliaConfig` directly.
 */
export async function loadProjectConfig(projectRoot: string): Promise<ResolvedFrameliaConfig> {
  try {
    return await loadFrameliaConfig(projectRoot);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}
