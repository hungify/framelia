import type { DashboardContractResult } from "@framelia/contracts";

/** POSIX-shell single-quoting, only when a value needs it. */
export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function positiveInteger(value: number | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * The `framelia baseline promote` command that would accept a failed page-baseline
 * contract's current target state as its new baseline (flags as defined in
 * packages/cli/src/commands/baseline.ts). The dashboard stays read-only: it only builds
 * the command for the user to review and run.
 *
 * `--key` is the recorded `toMatchPageBaseline` key (`baselineKey`) when the run carries
 * one; otherwise it falls back to the contract id and the UI asks the user to check it.
 * Undefined for anything that isn't a failed page-baseline result with a known target URL.
 */
export function promoteCommand(contract: DashboardContractResult): string | undefined {
  if (contract.baselineKind !== "page" || contract.status !== "failed") return undefined;
  const evidence = contract.captureEvidence;
  const targetUrl = contract.actual?.url || evidence?.finalUrl;
  if (!targetUrl) return undefined;

  const args: string[] = [
    "--key",
    contract.baselineKey ?? contract.contractId ?? contract.id,
    "--target-url",
    targetUrl,
  ];
  const selector =
    evidence?.scope.kind === "region"
      ? evidence.scope.selector
      : contract.capture.target?.definition.value;
  if (selector) args.push("--selector", selector);
  else if (evidence?.scope.kind === "page" && evidence.scope.fullPage) args.push("--full-page");
  const viewport =
    evidence?.viewport ?? (contract.capture.kind === "viewport" ? contract.capture.viewport : null);
  if (viewport && positiveInteger(viewport.width) && positiveInteger(viewport.height)) {
    args.push("--viewport-width", String(viewport.width));
    args.push("--viewport-height", String(viewport.height));
  }
  if (contract.sourceRunId) args.push("--run-id", contract.sourceRunId);
  return ["framelia", "baseline", "promote", ...args.map(shellQuote)].join(" ");
}
