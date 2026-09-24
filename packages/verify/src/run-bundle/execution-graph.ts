import type { CollectionManifest } from "@framelia/contracts/workflow";

import { canonicalJsonDigest } from "../canonical-json.ts";

/** Stable identity for the project dependency/teardown graph and every setup test tuple. */
export function computeExecutionGraphDigest(
  manifest: Pick<CollectionManifest, "projects" | "setupCases" | "visualCases">,
): `sha256:${string}` {
  const projects = [...manifest.projects]
    .map((project) => ({
      name: project.name,
      runtimeDigest: project.runtimeDigest,
      dependencies: [...project.dependencies].toSorted(),
      teardown: project.teardown ?? null,
      repeatEach: project.repeatEach,
      retries: project.retries,
      testDir: project.testDir,
    }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const setupCases = [...manifest.setupCases]
    .map((test) => ({
      project: test.project,
      specFile: test.specFile,
      specFileDigest: test.specFileDigest,
      location: test.location,
      testTitlePath: [...test.testTitlePath],
      repeatIndex: test.repeatIndex,
      graphRole: test.graphRole,
    }))
    .toSorted(
      (left, right) =>
        left.project.localeCompare(right.project) ||
        left.specFile.localeCompare(right.specFile) ||
        left.testTitlePath.join("\u0000").localeCompare(right.testTitlePath.join("\u0000")) ||
        left.repeatIndex - right.repeatIndex,
    );
  const visualCases = [...manifest.visualCases]
    .map((test) => ({
      binding: test.binding,
      project: test.project,
      projectRuntimeDigest: test.projectRuntimeDigest,
      specFile: test.specFile,
      testListFile: test.testListFile,
      specFileDigest: test.specFileDigest,
      testTitlePath: [...test.testTitlePath],
      repeatIndex: test.repeatIndex,
    }))
    .toSorted(
      (left, right) =>
        left.binding.contractId.localeCompare(right.binding.contractId) ||
        left.project.localeCompare(right.project) ||
        left.repeatIndex - right.repeatIndex ||
        left.specFile.localeCompare(right.specFile) ||
        left.testTitlePath.join("\u0000").localeCompare(right.testTitlePath.join("\u0000")),
    );
  return canonicalJsonDigest({ projects, setupCases, visualCases });
}
