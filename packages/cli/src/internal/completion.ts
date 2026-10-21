import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { Diagnostic } from "@framelia/contracts/workflow";
import {
  buildInstallCommand,
  buildUninstallCommand,
  type StricliAutoCompleteContext,
} from "@stricli/auto-complete";

import { BASH_COMPLETION_COMMAND, type CompletionShell } from "../cli-constants.ts";
import type { CommandEnvironment } from "../environment.ts";
import { UsageError } from "../exit.ts";
import type { CliResult } from "../output.ts";
import { failureOutcome, type FailureOutcome } from "./outcome.ts";

/** The command name completion is registered for in the shell profile. */
const TARGET_COMMAND = "framelia";

export interface CompletionOptions {
  readonly shell: CompletionShell;
}

type CompletionAction = "install" | "uninstall";
type CompletionCommand = `completion ${CompletionAction}`;

export interface CompletionOutcome {
  readonly formatVersion: 1;
  readonly kind: "framelia.completion-outcome";
  readonly command: CompletionCommand;
  readonly executionState: "completed";
  readonly exitCode: 0;
  readonly shell: CompletionShell;
  /** The shell profile the completion block was written to or removed from. */
  readonly profilePath: string;
  /** False when the profile already matched: a repeated install, or nothing to uninstall. */
  readonly changed: boolean;
  /** The executable bash runs on <TAB>; it must be on PATH next to `framelia`. */
  readonly proposalCommand: string;
  /** What the person still has to do for the change to reach a running shell. */
  readonly reload: string;
  readonly diagnostics: readonly Diagnostic[];
}

type CompletionResult = CliResult<
  CompletionOutcome | FailureOutcome<"framelia.completion-outcome", CompletionCommand>
>;

/** Installs bash completion for `framelia` into `~/.bashrc` (idempotent). */
export function completionInstallCommand(
  options: CompletionOptions,
  env: Pick<CommandEnvironment, "process">,
): Promise<CompletionResult> {
  return manageCompletion("install", options, env);
}

/** Removes the bash completion block `completion install` wrote, if there is one. */
export function completionUninstallCommand(
  options: CompletionOptions,
  env: Pick<CommandEnvironment, "process">,
): Promise<CompletionResult> {
  return manageCompletion("uninstall", options, env);
}

async function manageCompletion(
  action: CompletionAction,
  options: CompletionOptions,
  env: Pick<CommandEnvironment, "process">,
): Promise<CompletionResult> {
  const command: CompletionCommand = `completion ${action}`;
  try {
    // @stricli/auto-complete skips a shell it does not detect with only a stderr note;
    // checking first turns that into a structured failure instead of a silent no-op.
    const detected = env.process.env.SHELL ?? "";
    if (!detected.includes(options.shell)) {
      throw new UsageError(
        `$SHELL is ${JSON.stringify(detected)}, not ${options.shell}; run this from a ${options.shell} shell.`,
        { code: "COMPLETION_SHELL_NOT_DETECTED" },
      );
    }
    const home = env.process.env.HOME || os.homedir();
    const profilePath = path.join(home, ".bashrc");
    const before = readProfile(profilePath);
    await runStricliCompletion(action, env.process.env, home);
    const after = readProfile(profilePath);
    return {
      ok: true,
      exitCode: 0,
      body: {
        formatVersion: 1,
        kind: "framelia.completion-outcome",
        command,
        executionState: "completed",
        exitCode: 0,
        shell: options.shell,
        profilePath,
        changed: before !== after,
        proposalCommand: BASH_COMPLETION_COMMAND,
        reload: `Open a new ${options.shell} shell or run \`source ${profilePath}\`.`,
        diagnostics: [],
      },
    };
  } catch (error) {
    return failureOutcome({
      kind: "framelia.completion-outcome",
      command,
      error,
      fallbackCode: "COMPLETION_FAILED",
      stage: "completion",
      projectRoot: undefined,
    });
  }
}

function readProfile(profilePath: string): string {
  try {
    return fs.readFileSync(profilePath, "utf8");
  } catch (error) {
    throw new UsageError(
      `Expected to edit ${profilePath}, but it could not be read; create it and retry.`,
      { code: "COMPLETION_PROFILE_MISSING", cause: error },
    );
  }
}

/**
 * Runs @stricli/auto-complete's own install/uninstall command, so the profile block it writes
 * is exactly the one its uninstall later removes. Its plain-text notes are captured, never
 * written to stdout, which carries only the JSON outcome.
 */
async function runStricliCompletion(
  action: CompletionAction,
  processEnv: NodeJS.ProcessEnv,
  home: string,
): Promise<void> {
  const command =
    action === "install"
      ? buildInstallCommand<StricliAutoCompleteContext>(TARGET_COMMAND, {
          bash: BASH_COMPLETION_COMMAND,
        })
      : buildUninstallCommand<StricliAutoCompleteContext>(TARGET_COMMAND, { bash: true });
  let stderr = "";
  const ignore = { write: () => true };
  const capture = {
    write: (text: string) => {
      stderr += text;
      return true;
    },
  };
  const context: StricliAutoCompleteContext = {
    // The library only ever calls `write(text)` on these streams and reads `env.SHELL`.
    process: {
      env: processEnv,
      stdout: ignore,
      stderr: capture,
    } as unknown as StricliAutoCompleteContext["process"],
    os: { homedir: () => home },
  };
  const loaded = await command.loader();
  const implementation = typeof loaded === "function" ? loaded : loaded.default;
  const result = await implementation.call(context, {});
  if (result instanceof Error) throw result;
  if (stderr.trim() !== "") {
    throw new UsageError(stderr.trim(), { code: "COMPLETION_FAILED" });
  }
}
