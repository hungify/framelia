import {
  buildInstallCommand,
  buildUninstallCommand,
  type StricliAutoCompleteContext,
} from "@stricli/auto-complete";
import { buildRouteMap, type Command } from "@stricli/core";

import type { CliContext } from "../context.ts";

/** Bin that bash runs on every TAB; it must stay a separate entry point that skips project env loading. */
const BASH_COMPLETE_BIN = "__framelia_bash_complete";

// The library types its context with a full Node `process`, which `CliRuntime` only narrows.
// It reads SHELL and the output streams from `this.process`, but takes the home directory from
// the real `os.homedir()`: running these commands in-process with a fake process still edits
// the real ~/.bashrc, so tests must spawn the bin with HOME pointed at a temp directory.
const asCliCommand = (command: Command<StricliAutoCompleteContext>) =>
  command as unknown as Command<CliContext>;

export const completionRoutes = buildRouteMap<"install" | "uninstall", CliContext>({
  routes: {
    install: asCliCommand(buildInstallCommand("framelia", { bash: BASH_COMPLETE_BIN })),
    uninstall: asCliCommand(buildUninstallCommand("framelia", { bash: true })),
  },
  docs: { brief: "Install or remove bash tab completion (edits ~/.bashrc)." },
});
