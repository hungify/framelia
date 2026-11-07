import * as path from "node:path";

import type { Diagnostic, NextOperation } from "@framelia/contracts/workflow";
import { portableErrorMessage } from "@framelia/verify";
import type { ResolvedProjectPolicy } from "@framelia/verify/project-policy";

import type { CommandEnvironment } from "../environment.ts";
import type { CliResult } from "../output.ts";
import { optionalFigmaToken } from "./figma-token.ts";
import { errorCode, nextForFailureCode } from "./outcome.ts";
import { resolveLocalPlaywright } from "./playwright-transport.ts";
import { openProject } from "./project.ts";

export interface StatusOptions {
  readonly projectRoot: string | undefined;
}

export type StatusCheckName = "config" | "playwright" | "playwright-cli" | "figma-token";

/** One readiness check. Only `error` fails `status`; `warning` limits some commands. */
export interface StatusCheck {
  readonly name: StatusCheckName;
  readonly status: "ok" | "warning" | "error";
  readonly code?: string;
  readonly message: string;
}

export interface StatusBody {
  readonly ok: boolean;
  readonly name: "framelia";
  readonly version: string;
  readonly mode: "cli";
  readonly baselineKinds: readonly ["figma"];
  readonly projectRoot: string;
  /** Project-relative config file, when one was found. */
  readonly configPath?: string;
  readonly figmaTokenAvailable: boolean;
  readonly checks: readonly StatusCheck[];
  /** The `error` checks as diagnostics, matching every other command's outcome. */
  readonly diagnostics: readonly Diagnostic[];
  readonly next?: NextOperation;
}

function playwrightChecks(policy: ResolvedProjectPolicy): StatusCheck[] {
  if (!policy.playwright) {
    return [
      {
        name: "playwright",
        status: "warning",
        code: "PROJECT_POLICY_INCOMPLETE",
        message:
          "framelia.config declares no playwright block; `check` and `contract list` need playwright.config and the visual project names.",
      },
    ];
  }
  const checks: StatusCheck[] = [
    {
      name: "playwright",
      status: "ok",
      message: `${policy.playwright.config} with projects ${JSON.stringify(policy.playwright.projects)}.`,
    },
  ];
  try {
    resolveLocalPlaywright(policy.root);
    checks.push({
      name: "playwright-cli",
      status: "ok",
      message: "@playwright/test/cli resolves from the project.",
    });
  } catch (error) {
    checks.push({
      name: "playwright-cli",
      status: "error",
      code: errorCode(error) ?? "PLAYWRIGHT_NOT_INSTALLED",
      message: portableErrorMessage(error, policy.root),
    });
  }
  return checks;
}

/** Loads and validates the project policy, then reports what each workflow still needs. */
export async function statusCommand(
  options: StatusOptions,
  env: Pick<CommandEnvironment, "process" | "version">,
): Promise<CliResult<StatusBody>> {
  const runtime = env.process;
  const figmaTokenAvailable = optionalFigmaToken(runtime) !== undefined;
  const checks: StatusCheck[] = [];
  let projectRoot = path.resolve(runtime.cwd(), options.projectRoot ?? ".");
  let configPath: string | undefined;
  try {
    const project = openProject(options.projectRoot, runtime);
    projectRoot = project.root;
    const policy = await project.loadConfig();
    configPath = policy.configPath
      ? path.relative(policy.root, policy.configPath).split(path.sep).join("/")
      : undefined;
    checks.push({ name: "config", status: "ok", message: `${configPath ?? "config"} is valid.` });
    checks.push(...playwrightChecks(policy));
  } catch (error) {
    checks.push({
      name: "config",
      status: "error",
      code: errorCode(error) ?? "INVALID_PROJECT_CONFIG",
      message: portableErrorMessage(error, projectRoot),
    });
  }
  checks.push(
    figmaTokenAvailable
      ? { name: "figma-token", status: "ok", message: "FIGMA_ACCESS_TOKEN is set." }
      : {
          name: "figma-token",
          status: "warning",
          code: "FIGMA_TOKEN_MISSING",
          message:
            "FIGMA_ACCESS_TOKEN is not set; only contract create, contract refresh-baseline and capture need it. Set it in .env.local/.env or export it.",
        },
  );

  const errors = checks.filter((check) => check.status === "error");
  const ok = errors.length === 0;
  // `status` re-checks itself after a fix, so only a different command is a useful next step.
  const candidate = errors[0]?.code
    ? nextForFailureCode(errors[0].code, options.projectRoot)
    : undefined;
  const next = candidate?.argv[0] === "status" ? undefined : candidate;
  const body: StatusBody = {
    ok,
    name: "framelia",
    version: env.version,
    mode: "cli",
    baselineKinds: ["figma"],
    projectRoot,
    ...(configPath ? { configPath } : {}),
    figmaTokenAvailable,
    checks,
    diagnostics: errors.map((check) => ({
      code: check.code ?? "STATUS_CHECK_FAILED",
      stage: check.name,
      message: check.message,
    })),
    ...(next ? { next } : {}),
  };
  return ok ? { ok: true, exitCode: 0, body } : { ok: false, exitCode: 2, body };
}
