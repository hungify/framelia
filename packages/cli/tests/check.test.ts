import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CollectedCase } from "@framelia/contracts/workflow";
import type { ContractProjectCase } from "@framelia/verify/project-policy";
import { afterEach, describe, expect, it } from "vitest";

import { buildTestList, runCheck, selectMatrix } from "../src/internal/check.ts";
import type { CliRuntime } from "../src/runtime-types.ts";

const DIGEST = `sha256:${"a".repeat(64)}` as const;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function matrixCase(contractId: string, project: string, required = true): ContractProjectCase {
  return {
    contractId,
    contractFile: `contracts/${contractId}.json`,
    contractDigest: DIGEST,
    project,
    required,
  };
}

function collectedCase(overrides: Partial<CollectedCase> = {}): CollectedCase {
  return {
    formatVersion: 1,
    kind: "framelia.collected-case",
    binding: {
      formatVersion: 1,
      kind: "framelia.contract-binding",
      contractId: "home.visual",
      contractFile: "contracts/home.visual.json",
      contractDigest: DIGEST,
    },
    project: "chromium",
    projectRuntimeDigest: DIGEST,
    specFile: "tests/nested/visual.spec.ts",
    testListFile: "nested/visual.spec.ts",
    specFileDigest: DIGEST,
    location: { line: 10, column: 2 },
    testTitlePath: [" Group bytes ", "  Case bytes  "],
    repeatIndex: 0,
    ...overrides,
  };
}

function runtime(cwd: string): CliRuntime {
  return {
    cwd: () => cwd,
    env: {},
    stdin: process.stdin,
    stdout: { write: () => true },
    stderr: { write: () => true },
    exitCode: undefined,
  };
}

describe("check selection", () => {
  const matrix = [
    matrixCase("required.visual", "chromium"),
    matrixCase("required.visual", "firefox"),
    matrixCase("optional.visual", "chromium", false),
  ];
  const required = matrix.filter((entry) => entry.required);
  const authored = new Set(["required.visual", "optional.visual"]);
  const projects = ["chromium", "firefox"];

  it("uses the full required matrix for --all, while exact IDs can select optional contracts", () => {
    const all = selectMatrix(
      matrix,
      required,
      { contract: [], all: true, project: [], runtime: runtime("/project") },
      authored,
      projects,
    );
    expect(all.selected).toEqual(required);
    expect(all.scope).toBe("all");

    const optional = selectMatrix(
      matrix,
      required,
      {
        contract: ["optional.visual"],
        project: [],
        runtime: runtime("/project"),
      },
      authored,
      projects,
    );
    expect(optional.selected).toEqual([matrix[2]]);
    expect(optional.scope).toBe("subset");
  });

  it("narrows by exact projects without rewriting the full required matrix", () => {
    const selected = selectMatrix(
      matrix,
      required,
      { contract: [], all: true, project: ["firefox"], runtime: runtime("/project") },
      authored,
      projects,
    );
    expect(selected.selected).toEqual([matrix[1]]);
    expect(selected.scope).toBe("subset");
  });

  it.each([
    [{ contract: [], all: undefined, project: [] }, /requires --all/],
    [{ contract: ["required.visual"], all: true, project: [] }, /exactly one selector form/],
    [{ contract: ["missing.visual"], all: undefined, project: [] }, /Unknown authored contract/],
    [{ contract: ["required.visual"], all: undefined, project: ["webkit"] }, /Unknown configured/],
    [
      { contract: ["required.visual", "required.visual"], all: undefined, project: [] },
      /Duplicate contract id/,
    ],
  ] as const)("rejects invalid selector input %#", (request, expected) => {
    expect(() =>
      selectMatrix(
        matrix,
        required,
        { ...request, runtime: runtime("/project") },
        authored,
        projects,
      ),
    ).toThrow(expected);
  });
});

describe("Playwright --test-list projection", () => {
  it("preserves title bytes in the one exact named-project file-suite tuple", () => {
    expect(buildTestList([collectedCase()])).toBe(
      "[chromium] › nested/visual.spec.ts ›  Group bytes  ›   Case bytes  \n",
    );
  });

  it("uses Playwright's unnamed-project grammar without brackets", () => {
    const entry = collectedCase({
      project: "",
      testListFile: "visual.spec.ts",
      specFile: "visual.spec.ts",
      testTitlePath: ["case"],
    });
    expect(buildTestList([entry])).toBe("visual.spec.ts › case\n");
  });

  it.each([
    [{ project: "bad[name" }, /contains \[ or \]/],
    [{ project: "bad]name" }, /contains \[ or \]/],
    [{ testTitlePath: ["bad›title"] }, /Unicode ›/],
    [{ testTitlePath: ["bad\rtitle"] }, /CR, LF/],
    [{ testTitlePath: ["bad\ntitle"] }, /CR, LF/],
  ] as const)("rejects an ambiguous list tuple %#", (overrides, expected) => {
    expect(() =>
      buildTestList([collectedCase(overrides as unknown as Partial<CollectedCase>)]),
    ).toThrow(expected);
  });
});

describe("nested-cwd policy resolution", () => {
  it("resolves the project from cwd without a check-specific --project-root escape hatch", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-check-nested-cwd-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "apps", "nested"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "framelia.config.mjs"),
      'export default { playwright: { config: "playwright.config.ts", projects: ["chromium"] }, contracts: ["contracts/*.json"] };\n',
    );

    const outcome = await runCheck({
      contract: [],
      project: [],
      runtime: runtime(path.join(root, "apps", "nested")),
    });

    expect(outcome.diagnostics[0]?.message).toMatch(/requires --all/);
    expect(outcome.diagnostics[0]?.message).not.toMatch(/framelia\.config not found/);
  });
});
