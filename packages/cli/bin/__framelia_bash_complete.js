#!/usr/bin/env node
// Bash calls `__framelia_bash_complete $COMP_LINE`: argv is the command name followed by the
// words typed so far. A trailing space in COMP_LINE means the next word is still empty.
const inputs = process.argv.slice(3);
if (process.env.COMP_LINE?.endsWith(" ")) inputs.push("");

try {
  // Imported inside the try: the hook does not redirect stderr, so even a missing or broken
  // dist must not print a stack trace into the user's prompt on every TAB.
  const { proposeBashCompletions } = await import("../dist/cli.js");
  for (const completion of await proposeBashCompletions(inputs))
    process.stdout.write(`${completion}\n`);
} catch {
  // Intentionally silent.
}
