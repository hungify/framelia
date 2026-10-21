import { buildCommand } from "@stricli/core";

import { projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { ProjectInitOptions } from "../internal/project-init.ts";
import { emitResult } from "../output.ts";

export const initCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; prompts load through this.adapters.
    const { projectInitCommand } = await import("../internal/project-init.ts");
    return async function (this: CliContext, flags: ProjectInitOptions) {
      emitResult(this, await projectInitCommand(flags, this));
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      dryRun: {
        kind: "boolean",
        optional: true,
        brief: "print the complete change plan without writing",
      },
      force: {
        kind: "boolean",
        optional: true,
        brief: "compatibility flag; existing files remain protected",
      },
    },
    aliases: { r: "projectRoot", f: "force" },
  },
  docs: { brief: "Initialize Framelia in a project." },
});
