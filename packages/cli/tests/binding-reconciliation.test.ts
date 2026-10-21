import type { CollectedCase, CollectionManifest } from "@framelia/contracts/workflow";
import type { ContractProjectCase } from "@framelia/verify/project-policy";
import { describe, expect, it } from "vitest";

import { reconcileBinding } from "../src/internal/binding-reconciliation.ts";
import { reconcileSelectedCases } from "../src/internal/check.ts";

const digest = (char: string) => `sha256:${char.repeat(64)}` as const;

const expected: ContractProjectCase = {
  contractId: "home",
  contractFile: ".framelia/contracts/home/visual-contract.json",
  contractDigest: digest("a"),
  project: "chromium",
  required: true,
};

function collected(repeatIndex: number, overrides: Partial<CollectedCase["binding"]> = {}) {
  return {
    formatVersion: 1,
    kind: "framelia.collected-case",
    binding: {
      formatVersion: 1,
      kind: "framelia.contract-binding",
      contractId: expected.contractId,
      contractFile: expected.contractFile,
      contractDigest: expected.contractDigest,
      ...overrides,
    },
    project: "chromium",
    projectRuntimeDigest: digest("b"),
    specFile: "tests/visual.spec.ts",
    testListFile: "visual.spec.ts",
    specFileDigest: digest("c"),
    location: { line: 1, column: 0 },
    testTitlePath: ["home"],
    repeatIndex,
  } satisfies CollectedCase;
}

function manifest(visualCases: CollectedCase[], repeatEach = 2, project = "chromium") {
  return {
    formatVersion: 2,
    kind: "framelia.collection",
    runId: "run",
    projectRoot: "/project",
    policyDigest: digest("d"),
    projects: [
      {
        name: project,
        runtimeDigest: digest("b"),
        dependencies: [],
        repeatEach,
        retries: 0,
        testDir: "tests",
      },
    ],
    visualCases,
    setupCases: [],
  } satisfies CollectionManifest;
}

describe("reconcileBinding", () => {
  it.each([
    ["project-missing", manifest([], 1, "firefox"), { status: "project-missing" }],
    ["unbound", manifest([]), { status: "unbound" }],
    [
      "duplicate",
      manifest([collected(0), collected(0), collected(1)]),
      { status: "duplicate", repeatIndex: 0, matched: 2 },
    ],
    [
      "stale identity",
      manifest([collected(0), collected(1, { contractDigest: digest("e") })]),
      { status: "stale", reason: "identity" },
    ],
    ["missing repeat slot", manifest([collected(1)]), { status: "stale", reason: "repeat-slots" }],
    [
      "extra repeat slot",
      manifest([collected(0), collected(1), collected(2)]),
      { status: "stale", reason: "repeat-slots" },
    ],
  ] as const)("%s", (_name, input, result) => {
    expect(reconcileBinding(input, expected)).toEqual(result);
  });

  it("returns one collected case per repeat slot, ordered by slot", () => {
    const binding = reconcileBinding(manifest([collected(1), collected(0)]), expected);
    expect(binding.status).toBe("executable");
    expect(
      binding.status === "executable" && binding.cases.map((entry) => entry.repeatIndex),
    ).toEqual([0, 1]);
  });

  it("ignores bindings for other contracts and projects", () => {
    const other = { ...collected(0, { contractId: "other" }) };
    expect(reconcileBinding(manifest([other, collected(0), collected(1)]), expected).status).toBe(
      "executable",
    );
  });
});

describe("reconcileSelectedCases", () => {
  it("throws the reconciliation failure for a selected case", () => {
    expect(() => reconcileSelectedCases(manifest([collected(0)]), [expected])).toThrow(
      /home\/"chromium" has non-contiguous repeat slots/,
    );
    expect(() => reconcileSelectedCases(manifest([], 1, "firefox"), [expected])).toThrow(
      /omitted selected project "chromium"/,
    );
  });
});
