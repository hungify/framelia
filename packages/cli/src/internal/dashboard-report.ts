import * as path from "node:path";

import { exportDashboardReport } from "../dashboard/report.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { openProject } from "./project.ts";

export interface ReportOptions {
  readonly projectRoot: string | undefined;
  readonly run: string;
  readonly output: string;
}

export interface ReportResult {
  readonly runId: string;
  readonly reportPath: string;
}

export async function reportCommand(
  options: ReportOptions,
  runtime: CliRuntime,
): Promise<CliResult<ReportResult>> {
  const project = openProject(options.projectRoot, runtime);
  const indexPath = await exportDashboardReport({
    projectRoot: project.root,
    runId: options.run,
    outputDirectory: path.resolve(runtime.cwd(), options.output),
  });
  return { ok: true, body: { runId: options.run, reportPath: indexPath } };
}
