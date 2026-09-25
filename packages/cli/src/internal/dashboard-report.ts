import * as path from "node:path";

import { AppError } from "@framelia/verify";

import { exportDashboardReport } from "../dashboard/report.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openProject } from "./project.ts";
import { nextForRun, readRunProjection, type RunProjection } from "./run-projection.ts";

const REPORT_OUTCOME_FORMAT_VERSION = 1 as const;

export interface ReportOptions {
  readonly projectRoot: string | undefined;
  readonly run: string | undefined;
  readonly output: string | undefined;
}

export interface ReportOutcome extends RunProjection {
  readonly formatVersion: typeof REPORT_OUTCOME_FORMAT_VERSION;
  readonly kind: "framelia.report-outcome";
  readonly command: "report";
  readonly exitCode: 0 | 1 | 2;
  readonly reportPath: string;
  readonly next: { command: string; argv: string[] };
}

export interface ReportFailureOutcome {
  readonly formatVersion: typeof REPORT_OUTCOME_FORMAT_VERSION;
  readonly kind: "framelia.report-outcome";
  readonly command: "report";
  readonly executionState: "error";
  readonly visualVerdict: "not-evaluated";
  readonly exitCode: 2;
  readonly diagnostics: readonly { code: string; stage: string; message: string }[];
  readonly next: { command: string; argv: string[] };
}

function portableRelative(from: string, target: string): string {
  return path.relative(from, target).split(path.sep).join("/") || ".";
}

export interface ReportCommandDependencies {
  readonly clientRoot?: string;
}

export async function reportCommand(
  options: ReportOptions,
  runtime: CliRuntime,
  dependencies: ReportCommandDependencies = {},
): Promise<CliResult<ReportOutcome | ReportFailureOutcome>> {
  try {
    if (!options.run || !options.output) {
      throw new Error("report requires --run <id> and --output <directory>.");
    }
    const project = openProject(options.projectRoot, runtime);
    const projection = readRunProjection(project.root, options.run);
    const indexPath = await exportDashboardReport({
      projectRoot: project.root,
      runId: options.run,
      outputDirectory: path.resolve(runtime.cwd(), options.output),
      ...(dependencies.clientRoot ? { clientRoot: dependencies.clientRoot } : {}),
    });
    const exitCode =
      projection.executionState !== "completed"
        ? 2
        : projection.visualVerdict === "mismatched"
          ? 1
          : 0;
    return {
      ok: exitCode === 0,
      exitCode,
      body: {
        formatVersion: REPORT_OUTCOME_FORMAT_VERSION,
        kind: "framelia.report-outcome",
        command: "report",
        ...projection,
        exitCode,
        reportPath: portableRelative(runtime.cwd(), indexPath),
        next: nextForRun(projection, options.projectRoot),
      },
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 2,
      body: {
        formatVersion: REPORT_OUTCOME_FORMAT_VERSION,
        kind: "framelia.report-outcome",
        command: "report",
        executionState: "error",
        visualVerdict: "not-evaluated",
        exitCode: 2,
        diagnostics: [
          {
            code: error instanceof AppError ? error.code : "REPORT_FAILED",
            stage: "report",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        next: {
          command: "framelia",
          argv: [
            "report",
            "--run",
            options.run ?? "<run-id>",
            "--output",
            options.output ?? "framelia-report",
            ...(options.projectRoot ? ["--project-root", options.projectRoot] : []),
          ],
        },
      },
    };
  }
}
