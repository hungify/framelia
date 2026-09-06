import * as path from "node:path";

import { exportDashboardReport, readVerificationArtifact } from "../dashboard/report.ts";
import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";

export interface ReportOptions {
  readonly artifact: string;
  readonly output: string;
}

export interface ReportResult {
  readonly artifactPath: string;
  readonly reportPath: string;
}

export async function reportCommand(
  options: ReportOptions,
  runtime: CliRuntime,
): Promise<CliResult<ReportResult>> {
  const artifactPath = path.resolve(runtime.cwd(), options.artifact);
  const artifact = await readVerificationArtifact(artifactPath);
  const suiteName = path.basename(path.dirname(artifactPath));
  const indexPath = await exportDashboardReport({
    artifact,
    suiteName,
    outputDirectory: path.resolve(runtime.cwd(), options.output),
  });
  return { ok: true, body: { artifactPath, reportPath: indexPath } };
}
