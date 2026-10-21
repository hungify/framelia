import { buildCommand } from "@stricli/core";

import { identityParser, projectRootFlag } from "../cli-constants.ts";
import type { CliContext } from "../context.ts";
import type { AuthOptions } from "../internal/auth.ts";

export const authCommand = buildCommand({
  loader: async () => {
    const { authCommand: runAuthCommand } = await import("../internal/auth.ts");
    return function (this: CliContext, flags: AuthOptions) {
      return runAuthCommand(flags, this);
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
