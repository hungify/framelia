import { buildCommand } from "@stricli/core";

import { projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";

interface InitFlags {
  readonly projectRoot: string | undefined;
  readonly force: boolean | undefined;
}

export const initCommand = buildCommand({
  loader: async () => {
    const { projectInitCommand } = await import("../internal/project-init.ts");
    return function (this: CliContext, flags: InitFlags) {
      return projectInitCommand(
        { projectRoot: flags.projectRoot, force: flags.force },
        this.runtime,
      );
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
      force: {
        kind: "boolean",
        optional: true,
        brief: "replace existing Framelia config",
      },
    },
    aliases: { r: "projectRoot", f: "force" },
  },
  docs: { brief: "Initialize Framelia in a project." },
});
