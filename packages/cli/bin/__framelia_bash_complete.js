#!/usr/bin/env node
import { proposeBashCompletions } from "../dist/cli.js";

// Bash calls `__framelia_bash_complete $COMP_LINE`: argv is the command name followed by the
// words typed so far. A trailing space in COMP_LINE means the next word is still empty.
const inputs = process.argv.slice(3);
if (process.env.COMP_LINE?.endsWith(" ")) inputs.push("");

try {
  for (const completion of await proposeBashCompletions(inputs))
    process.stdout.write(`${completion}\n`);
} catch {
  // A broken completion must never print into the user's shell prompt.
}
