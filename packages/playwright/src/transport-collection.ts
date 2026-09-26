import {
  COLLECTION_FORMAT_VERSION,
  collectionManifestSchema,
  type CollectedCase,
  type CollectionManifest,
  type RunContext,
} from "@framelia/contracts/workflow";
import type { FullProject, Suite, TestCase } from "@playwright/test/reporter";

import {
  projectCollectedCase,
  projectCollectedProject,
  projectCollectedSetupCase,
} from "./collection.ts";

export interface TransportCollection {
  manifest: CollectionManifest;
  visualTests: Array<{ test: TestCase; collected: CollectedCase }>;
  dependencyProjects: Set<string>;
  teardownProjects: Set<string>;
}

function caseOrder(left: CollectedCase, right: CollectedCase): number {
  return (
    left.binding.contractId.localeCompare(right.binding.contractId) ||
    left.project.localeCompare(right.project) ||
    left.repeatIndex - right.repeatIndex ||
    left.specFile.localeCompare(right.specFile) ||
    left.testTitlePath.join("\u0000").localeCompare(right.testTitlePath.join("\u0000"))
  );
}

/** Captures only documented reporter metadata and normalizes all graph/set ordering. */
export function buildTransportCollection(suite: Suite, context: RunContext): TransportCollection {
  const tests = suite.allTests();
  const projectsByName = new Map<string, FullProject>();
  for (const test of tests) {
    const project = test.parent.project();
    if (project) projectsByName.set(project.name, project);
  }

  const selectedProjects = new Set(context.selectedProjects);
  for (const name of selectedProjects) {
    if (!projectsByName.has(name)) {
      throw new Error(
        `framelia reporter: selected Playwright project ${JSON.stringify(name)} was not collected.`,
      );
    }
  }

  const dependencyProjects = new Set<string>();
  const visitDependencies = (name: string, stack: Set<string>): void => {
    const project = projectsByName.get(name);
    if (!project) {
      throw new Error(
        `framelia reporter: Playwright dependency project ${JSON.stringify(name)} was not collected.`,
      );
    }
    for (const dependency of project.dependencies) {
      if (stack.has(dependency)) {
        throw new Error(
          `framelia reporter: cyclic Playwright project dependency involving ${JSON.stringify(dependency)}.`,
        );
      }
      if (!dependencyProjects.has(dependency)) {
        dependencyProjects.add(dependency);
        visitDependencies(dependency, new Set([...stack, dependency]));
      }
    }
  };
  for (const name of selectedProjects) visitDependencies(name, new Set([name]));

  const teardownProjects = new Set<string>();
  for (const graphProject of [...selectedProjects, ...dependencyProjects]) {
    const project = projectsByName.get(graphProject)!;
    if (project.teardown !== undefined) teardownProjects.add(project.teardown);
  }
  for (const project of teardownProjects) {
    if (dependencyProjects.has(project)) {
      throw new Error(
        `framelia reporter: project ${JSON.stringify(project)} is both a dependency and teardown target; this graph is unsupported.`,
      );
    }
  }
  for (const name of [...dependencyProjects, ...teardownProjects]) {
    if (selectedProjects.has(name)) {
      throw new Error(
        `framelia reporter: configured visual project ${JSON.stringify(name)} is also used as a dependency/teardown project; this graph is unsupported.`,
      );
    }
    if (!projectsByName.has(name)) {
      throw new Error(
        `framelia reporter: Playwright teardown project ${JSON.stringify(name)} was not collected.`,
      );
    }
  }

  const visualTests: Array<{ test: TestCase; collected: CollectedCase }> = [];
  for (const test of tests) {
    const project = test.parent.project();
    if (!project || !selectedProjects.has(project.name)) continue;
    const collected = projectCollectedCase(test, context.projectRoot, { strictAnnotation: true });
    if (collected) visualTests.push({ test, collected });
  }
  visualTests.sort((left, right) => caseOrder(left.collected, right.collected));

  const setupCases = tests
    .flatMap((test) => {
      const project = test.parent.project();
      if (!project) return [];
      if (dependencyProjects.has(project.name)) {
        return [projectCollectedSetupCase(test, context.projectRoot, "dependency")];
      }
      if (teardownProjects.has(project.name)) {
        return [projectCollectedSetupCase(test, context.projectRoot, "teardown")];
      }
      return [];
    })
    .toSorted(
      (left, right) =>
        left.graphRole.localeCompare(right.graphRole) ||
        left.project.localeCompare(right.project) ||
        left.specFile.localeCompare(right.specFile) ||
        left.testTitlePath.join("\u0000").localeCompare(right.testTitlePath.join("\u0000")) ||
        left.repeatIndex - right.repeatIndex,
    );

  const graphProjectNames = new Set([
    ...selectedProjects,
    ...dependencyProjects,
    ...teardownProjects,
  ]);
  const projects = [...graphProjectNames]
    .map((name) => projectCollectedProject(projectsByName.get(name)!, context.projectRoot))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const manifest = collectionManifestSchema.parse({
    formatVersion: COLLECTION_FORMAT_VERSION,
    kind: "framelia.collection",
    runId: context.runId,
    projectRoot: context.projectRoot,
    policyDigest: context.policyDigest,
    projects,
    visualCases: visualTests.map((entry) => entry.collected),
    setupCases,
  });
  return { manifest, visualTests, dependencyProjects, teardownProjects };
}
