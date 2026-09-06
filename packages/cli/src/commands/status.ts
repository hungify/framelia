import { buildCommand } from "@stricli/core";

import { projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { StatusOptions } from "../internal/status.ts";
import { emitResult } from "../output.ts";

export const statusCommand = buildCommand({
  loader: async () => {
    const { statusCommand: runStatusCommand } = await import("../internal/status.ts");
    return function (this: CliContext, flags: StatusOptions) {
      emitResult(this, runStatusCommand(flags, this.process, this.version));
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
