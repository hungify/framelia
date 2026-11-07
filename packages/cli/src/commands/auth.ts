import { buildCommand } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { AuthOptions } from "../internal/auth.ts";
import { emitResult } from "../output.ts";

export const authCommand = buildCommand({
  loader: async () => {
    const { authCommand: runAuthCommand } = await import("../internal/auth.ts");
    return async function (this: CliContext, flags: AuthOptions) {
      emitResult(this, await runAuthCommand(flags, this));
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
  docs: {
    brief: "Open Playwright for login and save browser session state.",
    fullDescription: [
      "Open a headed browser, wait for you to log in, and save the session to the",
      "configured storageStatePath (owner-only). Needs an interactive terminal.",
      "",
      "Example:",
      "  framelia auth --url https://app.example.com/login",
    ].join("\n"),
  },
});
