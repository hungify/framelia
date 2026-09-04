import { buildCommand } from "@stricli/core";

import { projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { ProjectInitOptions } from "../internal/project-init.ts";

export const initCommand = buildCommand({
  loader: async () => {
    // Stricli's loader is the intentional lazy boundary; keep prompt dependencies off startup.
    const [{ projectInitCommand }, { createClackPrompts }] = await Promise.all([
      import("../internal/project-init.ts"),
      import("../internal/clack-prompts.ts"),
    ]);
    return function (this: CliContext, flags: ProjectInitOptions) {
      return projectInitCommand(flags, createClackPrompts(this.process), this.process);
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
