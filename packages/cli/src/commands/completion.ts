import { buildCommand, buildRouteMap } from "@stricli/core";

import { COMPLETION_SHELLS } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { CompletionOptions } from "../internal/completion.ts";
import { emitResult } from "../output.ts";

const shellFlag = {
  kind: "enum",
  values: COMPLETION_SHELLS,
  default: "bash",
  brief: "shell whose completion to manage",
} as const;

const installCommand = buildCommand({
  loader: async () => {
    const { completionInstallCommand } = await import("../internal/completion.ts");
    return async function (this: CliContext, flags: CompletionOptions) {
      emitResult(this, await completionInstallCommand(flags, this));
    };
  },
  parameters: { flags: { shell: shellFlag } },
  docs: {
    brief: "Install bash completion for framelia into ~/.bashrc.",
    fullDescription: [
      "Add (or refresh) a marked block in ~/.bashrc that completes framelia commands,",
      "subcommands and flags through the __framelia_bash_complete executable shipped",
      "with this package. Re-running replaces the block instead of duplicating it.",
      "Exit 2 when $SHELL is not bash or ~/.bashrc does not exist.",
      "",
      "Examples:",
      "  framelia completion install",
      "  source ~/.bashrc",
    ].join("\n"),
  },
});

const uninstallCommand = buildCommand({
  loader: async () => {
    const { completionUninstallCommand } = await import("../internal/completion.ts");
    return async function (this: CliContext, flags: CompletionOptions) {
      emitResult(this, await completionUninstallCommand(flags, this));
    };
  },
  parameters: { flags: { shell: shellFlag } },
  docs: {
    brief: "Remove framelia's bash completion block from ~/.bashrc.",
    fullDescription: [
      "Remove the block `framelia completion install` added to ~/.bashrc.",
      "`changed: false` means there was nothing to remove.",
      "",
      "Example:",
      "  framelia completion uninstall",
    ].join("\n"),
  },
});

export const completionRoutes = buildRouteMap({
  routes: { install: installCommand, uninstall: uninstallCommand },
  docs: { brief: "Install or remove shell completion for framelia." },
});
