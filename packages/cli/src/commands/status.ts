import { JSON_INDENT_SPACES, resolveToken } from "@framelia/verify";
import type { Command } from "commander";

import { resolveProjectRoot, subcommand } from "./shared.ts";

export function registerStatusCommand(program: Command, packageVersion: string): void {
  program.addCommand(
    subcommand("status", "Print CLI capabilities and environment status.")
      .option("--project-root <dir>", "target project root")
      .action((options: { projectRoot?: string }) => {
        console.log(
          JSON.stringify(
            {
              ok: true,
              name: "framelia",
              version: packageVersion,
              mode: "cli",
              baselineKinds: ["figma"],
              projectRoot: resolveProjectRoot(options.projectRoot),
              figmaTokenAvailable: Boolean(resolveToken()),
            },
            null,
            JSON_INDENT_SPACES,
          ),
        );
      }),
  );
}
