import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { optionalFigmaToken } from "./figma-token.ts";
import { openProject } from "./project.ts";

export interface StatusOptions {
  readonly projectRoot: string | undefined;
}

export interface StatusBody {
  readonly ok: true;
  readonly name: "framelia";
  readonly version: string;
  readonly mode: "cli";
  readonly baselineKinds: readonly ["figma"];
  readonly projectRoot: string;
  readonly figmaTokenAvailable: boolean;
}

export function statusCommand(
  options: StatusOptions,
  runtime: CliRuntime,
  version: string,
): CliResult<StatusBody> {
  const body: StatusBody = {
    ok: true,
    name: "framelia",
    version,
    mode: "cli",
    baselineKinds: ["figma"],
    projectRoot: openProject(options.projectRoot, runtime).root,
    figmaTokenAvailable: optionalFigmaToken(runtime) !== undefined,
  };
  return { ok: true, body };
}
