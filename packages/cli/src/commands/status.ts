import { buildCommand } from "@stricli/core";

import { projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { StatusOptions } from "../internal/status.ts";
import { emitResult } from "../output.ts";

export const statusCommand = buildCommand({
  loader: async () => {
    const { statusCommand: runStatusCommand } = await import("../internal/status.ts");
    return async function (this: CliContext, flags: StatusOptions) {
      emitResult(this, await runStatusCommand(flags, this));
    };
  },
  parameters: {
    flags: {
      projectRoot: projectRootFlag,
    },
    aliases: { r: "projectRoot" },
  },
  docs: {
    brief: "Validate the project config and report what each workflow still needs.",
    fullDescription: [
      "Load and validate framelia.config, then report readiness checks: config,",
      "playwright block, the project's own @playwright/test/cli, FIGMA_ACCESS_TOKEN.",
      "Exit 2 when a check fails; `next` names the fix.",
      "",
      "Example:",
      "  framelia status --project-root .",
    ].join("\n"),
  },
});
