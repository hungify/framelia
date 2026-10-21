import * as path from "node:path";

import { exportDashboardReport } from "../dashboard/report.ts";
import type { CommandEnvironment } from "../environment.ts";
import type { CliResult } from "../output.ts";
import { failureDiagnostic, frameliaNext, runExitCode } from "./outcome.ts";
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

/** Test seam: where the bundled dashboard client is copied from. */
export interface ReportCommandSeams {
  readonly clientRoot?: string;
}

export async function reportCommand(
  options: ReportOptions,
  env: Pick<CommandEnvironment, "process">,
  seams: ReportCommandSeams = {},
): Promise<CliResult<ReportOutcome | ReportFailureOutcome>> {
  const runtime = env.process;
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
      ...(seams.clientRoot ? { clientRoot: seams.clientRoot } : {}),
    });
    const exitCode = runExitCode(
      projection.executionState === "completed",
      projection.visualVerdict,
    );
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
        diagnostics: [failureDiagnostic(error, "REPORT_FAILED", "report")],
        next: frameliaNext(
          [
            "report",
            "--run",
            options.run ?? "<run-id>",
            "--output",
            options.output ?? "framelia-report",
          ],
          options.projectRoot,
        ),
      },
    };
  }
}
