import { describe, expect, it } from "vitest";

import * as cliApi from "../src/cli.ts";
import * as publicApi from "../src/index.ts";
import * as internalApi from "../src/internal.ts";
import * as runBundleApi from "../src/run-bundle/index.ts";
import type { AuthoritativeRunVerdict, SelectedRun } from "../src/run-bundle/index.ts";
import * as testingApi from "../src/testing.ts";

export type SelectedRunTypeSurface = [SelectedRun, AuthoritativeRunVerdict];

describe("public API surface", () => {
  it("exposes the selected-run reader and loader-owned authority evaluator", () => {
    expect(runBundleApi.readSelectedRun).toBeTypeOf("function");
    expect(runBundleApi.evaluateAuthoritativeRun).toBeTypeOf("function");
    expect(runBundleApi.readRunBundle).toBeTypeOf("function");
  });

  it("keeps supported verification, CLI, internal, and test entry points", () => {
    expect(publicApi.compare).toBeTypeOf("function");
    expect(publicApi.FigmaBaselineProvider).toBeTypeOf("function");
    expect(cliApi.recordStorageState).toBeTypeOf("function");
    expect(internalApi.captureReadyPage).toBeTypeOf("function");
    expect(testingApi.makeSolidPng).toBeTypeOf("function");
  });
});
