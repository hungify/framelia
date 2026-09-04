import { buildCommand } from "@stricli/core";

import { projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import { emitResult } from "../output.ts";

interface StatusFlags {
  readonly projectRoot: string | undefined;
}

export const statusCommand = buildCommand({
  loader: async () => {
    const { statusCommand: runStatusCommand } = await import("../internal/status.ts");
    return function (this: CliContext, flags: StatusFlags) {
      const result = runStatusCommand(
        { projectRoot: flags.projectRoot, version: this.version },
        this.runtime,
      );
      emitResult(this, result, true);
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
    },
    aliases: { r: "projectRoot" },
  },
  docs: { brief: "Print CLI capabilities and environment status." },
});
