import type { CollectionManifest, Diagnostic } from "@framelia/contracts/workflow";
import { AppError, portableErrorMessage } from "@framelia/verify";
import {
  inspectAuthoredContracts,
  resolveContractProjectMatrix,
} from "@framelia/verify/project-policy";

import type { CliResult } from "../output.ts";
import type { CliRuntime } from "../runtime-types.ts";
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

export async function contractListCommand(
  options: ContractListOptions,
  runtime: CliRuntime,
  dependencies: PlaywrightTransportDependencies = {},
): Promise<CliResult<ContractListOutcome>> {
  try {
    const project = openProject(options.projectRoot, runtime);
    const policy = await project.loadConfig();
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
    } else {
      const validCases: Array<{
        contractId: string;
        contractFile: string;
        contractDigest: string;
        project: string;
        required: boolean;
      }> = [];
      for (const discovered of inspection.contracts) {
        try {
          const matrix = resolveContractProjectMatrix(policy, [discovered]);
          validCases.push(...matrix.allCases);
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
        if (!manifest) {
          entries.push({
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
          });
          continue;
        }
        const candidates = manifest.visualCases.filter(
          (collected) =>
            collected.binding.contractId === expected.contractId &&
            collected.project === expected.project,
        );
        const collectedProject = manifest.projects.find((entry) => entry.name === expected.project);
        const exact = candidates.filter(
          (collected) =>
            collected.binding.contractFile === expected.contractFile &&
            collected.binding.contractDigest === expected.contractDigest,
        );
        const expectedRepeats = collectedProject?.repeatEach ?? 1;
        const repeatCounts = new Map<number, number>();
        for (const candidate of exact) {
          repeatCounts.set(
            candidate.repeatIndex,
            (repeatCounts.get(candidate.repeatIndex) ?? 0) + 1,
          );
        }
        const completeRepeatSet =
          exact.length === expectedRepeats &&
          Array.from({ length: expectedRepeats }, (_, repeatIndex) => repeatIndex).every(
            (repeatIndex) => repeatCounts.get(repeatIndex) === 1,
          );
        if (candidates.length === 0) {
          entries.push({
            contractId: expected.contractId,
            contractPath: expected.contractFile,
            project: expected.project,
            status: "unbound",
            required: expected.required,
            diagnostics: [
              issue(
                "CONTRACT_UNBOUND",
                "binding",
                `No defineFigmaTests binding collected for ${expected.contractId}/${JSON.stringify(expected.project)}.`,
              ),
            ],
          });
        } else if (!completeRepeatSet || exact.length !== candidates.length) {
          const duplicate = [...repeatCounts.values()].some((count) => count > 1);
          entries.push({
            contractId: expected.contractId,
            contractPath: expected.contractFile,
            project: expected.project,
            status: "invalid",
            required: expected.required,
            diagnostics: [
              issue(
                duplicate ? "DUPLICATE_CONTRACT_BINDING" : "STALE_CONTRACT_BINDING",
                "binding",
                duplicate
                  ? `Collected duplicate bindings for ${expected.contractId}/${JSON.stringify(expected.project)} in at least one repeat slot; exactly one per slot is required.`
                  : `Collected binding identity or repeat slots for ${expected.contractId}/${JSON.stringify(expected.project)} do not match ${expected.contractFile}.`,
              ),
            ],
          });
        } else {
          entries.push({
            contractId: expected.contractId,
            contractPath: expected.contractFile,
            project: expected.project,
            status: "executable",
            required: expected.required,
            diagnostics: [],
          });
        }
      }
    }

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
