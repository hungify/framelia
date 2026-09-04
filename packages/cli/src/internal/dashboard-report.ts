import * as path from "node:path";

import { exportDashboardReport, readVerificationArtifact } from "../dashboard/report.ts";
import type { CliRuntime } from "../runtime-types.ts";

export interface ReportOptions {
  readonly artifact: string;
  readonly output: string;
}

export interface ReportResult {
  readonly artifactPath: string;
  readonly reportPath: string;
}

/**
 * CLI-only wiring around the public `../dashboard/report.ts` facade (unchanged --
 * `src/index.ts` still exports `exportDashboardReport`/`readVerificationArtifact` from
 * it directly): resolves artifact/output paths from the injected runtime's cwd, never
 * global `process.cwd()`, and returns the same `{artifactPath, reportPath}` shape the
 * old CLI printed via `emitResult`.
 */
export async function reportCommand(
  options: ReportOptions,
  runtime: CliRuntime,
): Promise<ReportResult> {
  const artifactPath = path.resolve(runtime.cwd(), options.artifact);
  const artifact = await readVerificationArtifact(artifactPath);
  const suiteName = path.basename(path.dirname(artifactPath));
  const indexPath = await exportDashboardReport({
    artifact,
    suiteName,
    outputDirectory: path.resolve(runtime.cwd(), options.output),
  });
  return { artifactPath, reportPath: indexPath };
}
