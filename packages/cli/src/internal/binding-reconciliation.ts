import type { CollectedCase, CollectionManifest } from "@framelia/contracts/workflow";
import type { ContractProjectCase } from "@framelia/verify/project-policy";

/**
 * How one authored contract/project case is bound by a Playwright collection manifest.
 * `executable` carries exactly one collected test per repeat slot, ordered by slot.
 */
export type BindingReconciliation =
  | { readonly status: "executable"; readonly cases: readonly CollectedCase[] }
  | { readonly status: "project-missing" }
  | { readonly status: "unbound" }
  | { readonly status: "duplicate"; readonly repeatIndex: number; readonly matched: number }
  | { readonly status: "stale"; readonly reason: "identity" | "repeat-slots" };

/**
 * The single binding rule shared by `check`, `contract list` and `contract create`: a case
 * is executable only when every repeat slot `0..repeatEach-1` holds exactly one collected
 * test whose binding names the same authored contract file and digest.
 */
export function reconcileBinding(
  manifest: CollectionManifest,
  expected: ContractProjectCase,
): BindingReconciliation {
  const project = manifest.projects.find((entry) => entry.name === expected.project);
  if (!project) return { status: "project-missing" };

  const candidates = manifest.visualCases.filter(
    (collected) =>
      collected.binding.contractId === expected.contractId &&
      collected.project === expected.project,
  );
  if (candidates.length === 0) return { status: "unbound" };

  const byRepeat = new Map<number, CollectedCase[]>();
  for (const candidate of candidates) {
    const entries = byRepeat.get(candidate.repeatIndex) ?? [];
    entries.push(candidate);
    byRepeat.set(candidate.repeatIndex, entries);
  }
  for (const [repeatIndex, matches] of byRepeat) {
    if (matches.length > 1) return { status: "duplicate", repeatIndex, matched: matches.length };
  }

  if (
    candidates.some(
      (collected) =>
        collected.binding.contractFile !== expected.contractFile ||
        collected.binding.contractDigest !== expected.contractDigest,
    )
  ) {
    return { status: "stale", reason: "identity" };
  }

  if (byRepeat.size !== project.repeatEach) return { status: "stale", reason: "repeat-slots" };
  const cases: CollectedCase[] = [];
  for (let repeatIndex = 0; repeatIndex < project.repeatEach; repeatIndex += 1) {
    const match = byRepeat.get(repeatIndex)?.[0];
    if (!match) return { status: "stale", reason: "repeat-slots" };
    cases.push(match);
  }
  return { status: "executable", cases };
}

/** The exact `defineFigmaTests` registration that makes an authored contract executable. */
export function registrationRecipe(contractPath: string): string {
  return [
    'import path from "node:path";',
    'import { defineFigmaTests } from "@framelia/playwright";',
    'import { test } from "@playwright/test";',
    `defineFigmaTests(test, { contracts: path.join(process.cwd(), ${JSON.stringify(contractPath)}),`,
    "  async prepare({ page }, { target }) {",
    "    await page.goto(target.path);",
    "    // Await this application's real scenario readiness before returning.",
    "  },",
    "});",
  ].join("\n");
}
