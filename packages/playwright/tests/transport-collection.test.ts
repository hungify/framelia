import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  BINDING_FORMAT_VERSION,
  RUN_CONTEXT_FORMAT_VERSION,
  TEST_REGISTRATION_FORMAT_VERSION,
  type RunContext,
} from "@framelia/contracts/workflow";
import { fileHash } from "@framelia/verify/project-policy";
import type { FullProject, Suite, TestCase } from "@playwright/test/reporter";
import { afterEach, describe, expect, it } from "vitest";

import { CONTRACT_ANNOTATION_TYPE } from "../src/registration.ts";
import { buildTransportCollection } from "../src/transport-collection.ts";

const roots: string[] = [];
const DIGEST = `sha256:${"a".repeat(64)}` as const;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function rootFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "framelia-transport-collection-"));
  roots.push(root);
  return root;
}

function projectFixture(
  root: string,
  name: string,
  dependencies: string[] = [],
  teardown?: string,
): FullProject {
  return {
    name,
    dependencies,
    ...(teardown === undefined ? {} : { teardown }),
    repeatEach: 1,
    retries: 0,
    testDir: path.join(root, "tests"),
    use: { browserName: "chromium", viewport: { width: 100, height: 100 } },
  } as unknown as FullProject;
}

function testFixture(
  root: string,
  project: FullProject,
  fileName: string,
  title: string,
  options: { contractId?: string; group?: string; malformed?: boolean } = {},
): TestCase {
  const absoluteFile = path.join(project.testDir, fileName);
  fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
  if (!fs.existsSync(absoluteFile))
    fs.writeFileSync(absoluteFile, `// ${project.name}:${fileName}\n`);
  const fileSuite = {
    type: "file",
    title: fileName,
    parent: undefined,
    project: () => project,
  } as unknown as Suite;
  const parent = options.group
    ? ({
        type: "describe",
        title: options.group,
        parent: fileSuite,
        project: () => project,
      } as unknown as Suite)
    : fileSuite;
  const annotations = options.contractId
    ? [
        {
          type: CONTRACT_ANNOTATION_TYPE,
          description: options.malformed
            ? "not-json"
            : JSON.stringify({
                formatVersion: TEST_REGISTRATION_FORMAT_VERSION,
                kind: "framelia.test-registration",
                binding: {
                  formatVersion: BINDING_FORMAT_VERSION,
                  kind: "framelia.contract-binding",
                  contractId: options.contractId,
                  contractFile: `contracts/${options.contractId}.json`,
                  contractDigest: DIGEST,
                },
                specFile: `tests/${fileName}`,
                specDigest: fileHash(absoluteFile),
              }),
        },
      ]
    : [];
  return {
    id: `${project.name}:${fileName}:${title}`,
    title,
    parent,
    annotations,
    location: { file: absoluteFile, line: 3, column: 5 },
    repeatEachIndex: 0,
  } as unknown as TestCase;
}

function contextFixture(root: string): RunContext {
  return {
    formatVersion: RUN_CONTEXT_FORMAT_VERSION,
    kind: "framelia.run-context",
    mode: "collect",
    projectRoot: root,
    runId: "collection-run",
    policyDigest: DIGEST,
    selectedProjects: ["chromium"],
    manifestPath: path.join(root, "transport", "manifest.json"),
    statusPath: path.join(root, "transport", "status.json"),
  };
}

function suiteFixture(tests: TestCase[]): Suite {
  return { allTests: () => tests } as unknown as Suite;
}

describe("buildTransportCollection", () => {
  it("captures transitive dependencies and every selected/dependency teardown while excluding unrelated tests", () => {
    const root = rootFixture();
    const chromium = projectFixture(root, "chromium", ["seed"], "cleanup");
    const seed = projectFixture(root, "seed", ["database"], "seed-cleanup");
    const database = projectFixture(root, "database");
    const cleanup = projectFixture(root, "cleanup");
    const seedCleanup = projectFixture(root, "seed-cleanup");
    const unrelated = projectFixture(root, "unrelated");
    const tests = [
      testFixture(root, unrelated, "unrelated.spec.ts", "ignored", {
        contractId: "unrelated.visual",
      }),
      testFixture(root, seedCleanup, "seed-cleanup.spec.ts", "clean seed"),
      testFixture(root, chromium, "visual.spec.ts", "  Case bytes  ", {
        contractId: "home.visual",
        group: " Group bytes ",
      }),
      testFixture(root, database, "database.spec.ts", "database setup"),
      testFixture(root, cleanup, "cleanup.spec.ts", "cleanup"),
      testFixture(root, seed, "seed.spec.ts", "seed setup"),
    ];

    const first = buildTransportCollection(suiteFixture(tests), contextFixture(root));
    const shuffled = buildTransportCollection(
      suiteFixture([tests[3]!, tests[5]!, tests[2]!, tests[0]!, tests[4]!, tests[1]!]),
      contextFixture(root),
    );

    expect(first.manifest).toEqual(shuffled.manifest);
    expect(first.manifest.projects.map((entry) => entry.name)).toEqual([
      "chromium",
      "cleanup",
      "database",
      "seed",
      "seed-cleanup",
    ]);
    expect([...first.dependencyProjects].toSorted()).toEqual(["database", "seed"]);
    expect([...first.teardownProjects].toSorted()).toEqual(["cleanup", "seed-cleanup"]);
    expect(first.manifest.visualCases).toHaveLength(1);
    expect(first.manifest.visualCases[0]?.testTitlePath).toEqual([
      " Group bytes ",
      "  Case bytes  ",
    ]);
    expect(first.manifest.visualCases[0]?.testListFile).toBe("visual.spec.ts");
    expect(first.manifest.setupCases.map((entry) => [entry.project, entry.graphRole])).toEqual([
      ["database", "dependency"],
      ["seed", "dependency"],
      ["cleanup", "teardown"],
      ["seed-cleanup", "teardown"],
    ]);
  });

  it("rejects malformed annotations in selected visual projects", () => {
    const root = rootFixture();
    const chromium = projectFixture(root, "chromium");
    const malformed = testFixture(root, chromium, "visual.spec.ts", "case", {
      contractId: "home.visual",
      malformed: true,
    });

    expect(() => buildTransportCollection(suiteFixture([malformed]), contextFixture(root))).toThrow(
      /malformed framelia\.contract JSON/,
    );
  });

  it("rejects a selected visual project reused as setup infrastructure", () => {
    const root = rootFixture();
    const chromium = projectFixture(root, "chromium", ["seed"]);
    const seed = projectFixture(root, "seed", ["chromium"]);
    const tests = [
      testFixture(root, chromium, "visual.spec.ts", "case", { contractId: "home.visual" }),
      testFixture(root, seed, "seed.spec.ts", "seed"),
    ];

    expect(() => buildTransportCollection(suiteFixture(tests), contextFixture(root))).toThrow(
      /cyclic Playwright project dependency|also used as a dependency/,
    );
  });
});
