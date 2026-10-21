import type { CollectionManifest, Diagnostic } from "@framelia/contracts/workflow";
import { AppError, portableErrorMessage } from "@framelia/verify";
import {
  inspectAuthoredContracts,
  resolveContractProjectMatrix,
  type ContractProjectCase,
  type ResolvedProjectPolicy,
} from "@framelia/verify/project-policy";

import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
import { reconcileBinding, type BindingReconciliation } from "./binding-reconciliation.ts";
import {
  collectPlaywrightBindings,
  type PlaywrightTransportDependencies,
} from "./playwright-collection.ts";
import { openProject } from "./project.ts";

const CONTRACT_LIST_OUTCOME_FORMAT_VERSION = 1 as const;

export interface ContractListOptions {
  readonly projectRoot: string | undefined;
}

export type ContractBindingStatus = "configured" | "executable" | "unbound" | "invalid";

export interface ContractListEntry {
  readonly contractId?: string;
  readonly contractPath: string;
  readonly project?: string;
  readonly status: ContractBindingStatus;
  readonly required?: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ContractListOutcome {
  readonly formatVersion: typeof CONTRACT_LIST_OUTCOME_FORMAT_VERSION;
  readonly kind: "framelia.contract-list-outcome";
  readonly command: "contract list";
  readonly executionState: "completed" | "blocked" | "error";
  readonly exitCode: 0 | 2;
  readonly contracts: readonly ContractListEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly next?: { command: string; argv: string[] };
}

function issue(code: string, stage: string, message: string): Diagnostic {
  return { code, stage, message };
}

export interface ContractBindings {
  readonly entries: ContractListEntry[];
  readonly diagnostics: Diagnostic[];
}

function bindingEntry(
  expected: ContractProjectCase,
  binding: BindingReconciliation,
): ContractListEntry {
  const base = {
    contractId: expected.contractId,
    contractPath: expected.contractFile,
    project: expected.project,
    required: expected.required,
  };
  const label = `${expected.contractId}/${JSON.stringify(expected.project)}`;
  switch (binding.status) {
    case "executable":
      return { ...base, status: "executable", diagnostics: [] };
    case "project-missing":
    case "unbound":
      return {
        ...base,
        status: "unbound",
        diagnostics: [
          issue(
            "CONTRACT_UNBOUND",
            "binding",
            `No defineFigmaTests binding collected for ${label}.`,
          ),
        ],
      };
    case "duplicate":
      return {
        ...base,
        status: "invalid",
        diagnostics: [
          issue(
            "DUPLICATE_CONTRACT_BINDING",
            "binding",
            `Collected duplicate bindings for ${label} in at least one repeat slot; exactly one per slot is required.`,
          ),
        ],
      };
    case "stale":
      return {
        ...base,
        status: "invalid",
        diagnostics: [
          issue(
            "STALE_CONTRACT_BINDING",
            "binding",
            `Collected binding identity or repeat slots for ${label} do not match ${expected.contractFile}.`,
          ),
        ],
      };
  }
}

/**
 * Inspects every authored contract and classifies each contract/project case against one
 * shared Playwright collection. Collection or policy problems become diagnostics, never throws.
 */
export async function listContractBindings(
  policy: ResolvedProjectPolicy,
  runtime: CliRuntime,
  dependencies: PlaywrightTransportDependencies = {},
): Promise<ContractBindings> {
  const inspection = await inspectAuthoredContracts(policy);
  const entries: ContractListEntry[] = inspection.invalid.map((entry) => ({
    ...(entry.contractId ? { contractId: entry.contractId } : {}),
    contractPath: entry.file,
    status: "invalid",
    diagnostics: [issue(entry.code, "discovery", entry.message)],
  }));
  const diagnostics: Diagnostic[] = [];

  if (!policy.playwright || !policy.policyDigest) {
    const message =
      "framelia.config must declare playwright.config and exact visual project names before bindings can be collected.";
    diagnostics.push(issue("PROJECT_POLICY_INCOMPLETE", "configuration", message));
    for (const discovered of inspection.contracts) {
      entries.push({
        contractId: discovered.contract.id,
        contractPath: discovered.file,
        status: "invalid",
        required: discovered.contract.required,
        diagnostics: [issue("PROJECT_POLICY_INCOMPLETE", "configuration", message)],
      });
    }
    return { entries, diagnostics };
  }

  const validCases: ContractProjectCase[] = [];
  for (const discovered of inspection.contracts) {
    try {
      validCases.push(...resolveContractProjectMatrix(policy, [discovered]).allCases);
    } catch (error) {
      entries.push({
        contractId: discovered.contract.id,
        contractPath: discovered.file,
        status: "invalid",
        required: discovered.contract.required,
        diagnostics: [
          issue(
            error instanceof AppError ? error.code : "CONTRACT_MATRIX_INVALID",
            "configuration",
            portableErrorMessage(error, policy.root),
          ),
        ],
      });
    }
  }

  let manifest: CollectionManifest | undefined;
  try {
    manifest = await collectPlaywrightBindings({
      policy,
      selectedProjects: policy.playwright.projects,
      runtime,
      dependencies,
    });
  } catch (error) {
    diagnostics.push(
      issue("COLLECTION_BLOCKED", "collection", portableErrorMessage(error, policy.root)),
    );
  }

  for (const expected of validCases) {
    entries.push(
      manifest
        ? bindingEntry(expected, reconcileBinding(manifest, expected))
        : {
            contractId: expected.contractId,
            contractPath: expected.contractFile,
            project: expected.project,
            status: "configured",
            required: expected.required,
            diagnostics: [
              issue(
                "COLLECTION_BLOCKED",
                "collection",
                "The authored contract/project case is configured, but executable binding collection did not complete.",
              ),
            ],
          },
    );
  }
  return { entries, diagnostics };
}

export async function contractListCommand(
  options: ContractListOptions,
  runtime: CliRuntime,
  dependencies: PlaywrightTransportDependencies = {},
): Promise<CliResult<ContractListOutcome>> {
  try {
    const policy = await openProject(options.projectRoot, runtime).loadConfig();
    const { entries, diagnostics } = await listContractBindings(policy, runtime, dependencies);

    entries.sort((left, right) =>
      `${left.contractId ?? ""}\0${left.project ?? ""}\0${left.contractPath}`.localeCompare(
        `${right.contractId ?? ""}\0${right.project ?? ""}\0${right.contractPath}`,
      ),
    );
    const invalid = entries.some((entry) => entry.status === "invalid");
    const blocked = diagnostics.length > 0;
    const exitCode = invalid || blocked ? 2 : 0;
    return {
      ok: exitCode === 0,
      exitCode,
      body: {
        formatVersion: CONTRACT_LIST_OUTCOME_FORMAT_VERSION,
        kind: "framelia.contract-list-outcome",
        command: "contract list",
        executionState: invalid ? "error" : blocked ? "blocked" : "completed",
        exitCode,
        contracts: entries,
        diagnostics,
        next: entries.some((entry) => entry.status === "unbound")
          ? {
              command: "framelia",
              argv: [
                "contract",
                "list",
                ...(options.projectRoot ? ["--project-root", options.projectRoot] : []),
              ],
            }
          : undefined,
      },
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: 2,
      body: {
        formatVersion: CONTRACT_LIST_OUTCOME_FORMAT_VERSION,
        kind: "framelia.contract-list-outcome",
        command: "contract list",
        executionState: "error",
        exitCode: 2,
        contracts: [],
        diagnostics: [
          issue(
            error instanceof AppError ? error.code : "CONTRACT_LIST_FAILED",
            "list",
            error instanceof Error ? error.message : String(error),
          ),
        ],
      },
    };
  }
}
