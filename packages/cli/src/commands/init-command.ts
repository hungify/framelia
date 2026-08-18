import type { Command } from "commander";

import { runProjectInit } from "../init.ts";
import { resolveProjectRoot, subcommand } from "./shared.ts";

export function registerInitCommand(program: Command): void {
  program.addCommand(
    subcommand("init", "Initialize Framelia in a project.")
      .option("--project-root <dir>", "target project root")
      .option("--force", "replace existing Framelia config")
      .action((options: { projectRoot?: string; force?: boolean }) =>
        runProjectInit({
          projectRoot: resolveProjectRoot(options.projectRoot),
          force: options.force,
        }),
      ),
  );
}
