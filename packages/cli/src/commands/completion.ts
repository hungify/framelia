import {
  buildInstallCommand,
  buildUninstallCommand,
  type StricliAutoCompleteContext,
} from "@stricli/auto-complete";
import { buildRouteMap, type Command } from "@stricli/core";

import type { CliContext } from "../context.ts";

/** Bin that bash runs on every TAB; it must stay a separate entry point that skips project env loading. */
export const BASH_COMPLETE_BIN = "__framelia_bash_complete";

// The library wants a full Node `process`; `CliRuntime` only narrows it and is the real
// `process` outside tests, so these commands are safe to run with a `CliContext`.
const asCliCommand = (command: Command<StricliAutoCompleteContext>) =>
  command as unknown as Command<CliContext>;

export const completionRoutes = buildRouteMap<"install" | "uninstall", CliContext>({
  routes: {
    install: asCliCommand(buildInstallCommand("framelia", { bash: BASH_COMPLETE_BIN })),
    uninstall: asCliCommand(buildUninstallCommand("framelia", { bash: true })),
  },
  docs: { brief: "Install or remove bash tab completion (edits ~/.bashrc)." },
});
