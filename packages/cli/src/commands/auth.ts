import { buildCommand } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { AuthPromptAdapter } from "../internal/auth.ts";

interface AuthFlags {
  readonly url: string;
  readonly projectRoot: string | undefined;
  readonly yes: boolean | undefined;
}

export const authCommand = buildCommand({
  loader: async () => {
    const [{ authCommand: runAuthCommand }, clack] = await Promise.all([
      import("../internal/auth.ts"),
      import("@clack/prompts"),
    ]);
    // Constructed once per invocation, inside the lazy loader, so `@clack/prompts`
    // stays out of every other command's static import graph (see the plan's
    // Architecture §1 lazy-loading rule).
    const prompts: AuthPromptAdapter = {
      intro: (message) => clack.intro(message),
      outro: (message) => clack.outro(message),
      note: (message, title) => clack.note(message, title),
      confirm: async (message, initialValue) => {
        const answer = await clack.confirm({ message, initialValue });
        return !clack.isCancel(answer) && answer === true;
      },
    };
    return function (this: CliContext, flags: AuthFlags) {
      return runAuthCommand(
        { url: flags.url, projectRoot: flags.projectRoot, yes: flags.yes },
        prompts,
        this.runtime,
      );
    };
  },
  parameters: {
    flags: {
      url: { kind: "parsed", parse: identityParser, brief: "login URL", placeholder: "url" },
      projectRoot: projectRootFlag,
      yes: {
        kind: "boolean",
        optional: true,
        brief: "skip existing auth-state replacement confirmation",
      },
    },
    aliases: { u: "url", r: "projectRoot", y: "yes" },
  },
  docs: { brief: "Open Playwright for login and save browser session state." },
});
