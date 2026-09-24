import * as path from "node:path";

import {
  COLLECTED_CASE_FORMAT_VERSION,
  collectedCaseSchema,
  collectedProjectSchema,
  collectedSetupCaseSchema,
  testRegistrationSchema,
  type CollectedCase,
  type CollectedProject,
  type CollectedSetupCase,
  type TestRegistration,
} from "@framelia/contracts/workflow";
import { canonicalJsonDigest, type CanonicalJsonValue } from "@framelia/verify";
import { fileHash } from "@framelia/verify/project-policy";
import type { BrowserContextOptions } from "@playwright/test";
import type { FullProject, Suite, TestCase } from "@playwright/test/reporter";

import { CONTRACT_ANNOTATION_TYPE } from "./registration.ts";

export function readContractRegistration(
  test: TestCase,
  options: { strict?: boolean } = {},
): TestRegistration | undefined {
  const annotation = (test.annotations ?? []).find(
    (candidate) => candidate.type === CONTRACT_ANNOTATION_TYPE,
  );
  if (!annotation) return undefined;
  if (!annotation.description) {
    if (options.strict) {
      throw new Error(
        `framelia reporter: test ${JSON.stringify(test.title)} has a framelia.contract annotation without a payload.`,
      );
    }
    return undefined;
  }
  const parsed = (() => {
    try {
      return JSON.parse(annotation.description) as unknown;
    } catch (error) {
      if (options.strict) {
        throw new Error(
          `framelia reporter: test ${JSON.stringify(test.title)} has malformed framelia.contract JSON.`,
          { cause: error },
        );
      }
      return undefined;
    }
  })();
  if (parsed === undefined) return undefined;
  const result = testRegistrationSchema.safeParse(parsed);
  if (!result.success) {
    if (options.strict) {
      throw new Error(
        `framelia reporter: test ${JSON.stringify(test.title)} has an incompatible framelia.contract annotation: ${result.error.message}`,
      );
    }
    return undefined;
  }
  return result.data;
}

export function findFileSuite(suite: Suite | undefined): Suite | undefined {
  let current = suite;
  while (current) {
    if (current.type === "file") return current;
    current = current.parent;
  }
  return undefined;
}

/** Secrets-safe identity derived only from documented, pixel-relevant project metadata. */
export function computeProjectRuntimeDigest(project: FullProject | undefined): `sha256:${string}` {
  const use = project?.use as (FullProject["use"] & BrowserContextOptions) | undefined;
  const relevant: CanonicalJsonValue = {
    name: project?.name ?? null,
    browserName: use?.browserName ?? null,
    viewport: (use?.viewport ?? null) as CanonicalJsonValue,
    screen: (use?.screen ?? null) as CanonicalJsonValue,
    deviceScaleFactor: use?.deviceScaleFactor ?? null,
    locale: use?.locale ?? null,
    timezoneId: use?.timezoneId ?? null,
    colorScheme: use?.colorScheme ?? null,
    reducedMotion: use?.reducedMotion ?? null,
    forcedColors: use?.forcedColors ?? null,
    contrast: use?.contrast ?? null,
    userAgent: use?.userAgent ?? null,
    isMobile: use?.isMobile ?? null,
    hasTouch: use?.hasTouch ?? null,
    javaScriptEnabled: use?.javaScriptEnabled ?? null,
    serviceWorkers: use?.serviceWorkers ?? null,
    offline: use?.offline ?? null,
    ignoreHTTPSErrors: use?.ignoreHTTPSErrors ?? null,
    bypassCSP: use?.bypassCSP ?? null,
    permissions: [...(use?.permissions ?? [])].toSorted(),
  };
  return canonicalJsonDigest(relevant);
}

function portableRelative(root: string, absolutePath: string, label: string): string {
  const relative = path.relative(root, absolutePath).split(path.sep).join("/");
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`framelia reporter: ${label} is outside project root ${root}.`);
  }
  return relative || ".";
}

function testIdentity(
  test: TestCase,
  projectRoot: string,
): {
  project: FullProject;
  specFile: string;
  testListFile: string;
  testTitlePath: string[];
} {
  const project = test.parent.project();
  const fileSuite = findFileSuite(test.parent);
  if (!project || !fileSuite) {
    throw new Error(
      `framelia reporter: test ${JSON.stringify(test.title)} has no documented project/file-suite identity.`,
    );
  }
  const absoluteSpec = path.resolve(project.testDir, fileSuite.title);
  const specFile = portableRelative(projectRoot, absoluteSpec, "spec file");
  const testListFile = fileSuite.title.split(path.sep).join("/");
  const suiteTitles: string[] = [];
  let parent: Suite | undefined = test.parent;
  while (parent && parent !== fileSuite) {
    if (parent.title) suiteTitles.unshift(parent.title);
    parent = parent.parent;
  }
  return { project, specFile, testListFile, testTitlePath: [...suiteTitles, test.title] };
}

export function projectCollectedCase(
  test: TestCase,
  projectRoot: string,
  options: { strictAnnotation?: boolean } = {},
): CollectedCase | undefined {
  const registration = readContractRegistration(test, { strict: options.strictAnnotation });
  if (!registration) return undefined;
  const identity = testIdentity(test, projectRoot);
  if (registration.specFile !== identity.specFile) {
    throw new Error(
      `framelia reporter: contract ${JSON.stringify(registration.binding.contractId)} registered spec ${registration.specFile}, but Playwright collected it from ${identity.specFile}.`,
    );
  }
  return collectedCaseSchema.parse({
    formatVersion: COLLECTED_CASE_FORMAT_VERSION,
    kind: "framelia.collected-case",
    binding: registration.binding,
    project: identity.project.name,
    projectRuntimeDigest: computeProjectRuntimeDigest(identity.project),
    specFile: identity.specFile,
    testListFile: identity.testListFile,
    specFileDigest: registration.specDigest,
    location: { line: test.location.line, column: test.location.column },
    testTitlePath: identity.testTitlePath,
    repeatIndex: test.repeatEachIndex,
  });
}

export function projectCollectedProject(
  project: FullProject,
  projectRoot: string,
): CollectedProject {
  return collectedProjectSchema.parse({
    name: project.name,
    runtimeDigest: computeProjectRuntimeDigest(project),
    dependencies: [...project.dependencies],
    ...(project.teardown === undefined ? {} : { teardown: project.teardown }),
    repeatEach: project.repeatEach,
    retries: project.retries,
    testDir: portableRelative(projectRoot, project.testDir, "Playwright testDir"),
  });
}

export function projectCollectedSetupCase(
  test: TestCase,
  projectRoot: string,
  graphRole: CollectedSetupCase["graphRole"],
): CollectedSetupCase {
  const identity = testIdentity(test, projectRoot);
  return collectedSetupCaseSchema.parse({
    project: identity.project.name,
    specFile: identity.specFile,
    specFileDigest: fileHash(path.resolve(projectRoot, identity.specFile)),
    location: { line: test.location.line, column: test.location.column },
    testTitlePath: identity.testTitlePath,
    repeatIndex: test.repeatEachIndex,
    graphRole,
  });
}

export function contractAnnotatedTests(suite: Suite, strict = false): TestCase[] {
  return suite
    .allTests()
    .filter((test) => readContractRegistration(test, { strict }) !== undefined);
}
