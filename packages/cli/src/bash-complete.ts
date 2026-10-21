import { proposeCompletions } from "@stricli/core";

import { completionApp, PACKAGE_VERSION } from "./app.ts";
import { buildContext } from "./context.ts";
import type { CliRuntime } from "./runtime-types.ts";

/**
 * The `__framelia_bash_complete` entry point bash runs on <TAB> once `framelia completion
 * install` has wired it: `__framelia_bash_complete $COMP_LINE`. `argv[0]` is the completed
 * command's own name, the rest are the words typed so far. Prints one proposal per line.
 *
 * Proposals come from the route tree and flag definitions alone: this never loads a project
 * `.env`, never runs a command loader, and never touches an adapter. A failure prints
 * nothing, so a broken proposal can never break the person's shell.
 */
export async function runBashComplete(
  argv: readonly string[] = process.argv.slice(2),
  options: { process?: CliRuntime } = {},
): Promise<void> {
  const context = buildContext({ process: options.process, version: PACKAGE_VERSION });
  const inputs = argv.slice(1);
  // Bash drops the trailing empty word, so a line ending in a space means "propose the next
  // word" rather than "finish the current one".
  if (context.process.env.COMP_LINE?.endsWith(" ")) inputs.push("");
  try {
    const proposals = await proposeCompletions(completionApp, inputs, context);
    for (const { completion } of proposals) context.process.stdout.write(`${completion}\n`);
  } catch {
    // Completion is best-effort; the shell falls back to filename completion.
  }
}
