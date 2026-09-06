import { describe, expect, it } from "vitest";

import {
  AUTH_STATE_RELATIVE_PATH,
  DEFAULT_AUTH_STATE_PATH,
  DEFAULT_DISCOVERY_DIR,
  DISCOVERY_DIR_NAME,
  FRAMELIA_DIR,
  VISUAL_ARTIFACT_DIR_PATTERN,
  VISUAL_CONTRACT_FILE,
  VISUAL_VERIFICATION_FILE,
  VISUAL_VERIFICATIONS_DIR,
  VISUAL_VERIFICATIONS_ROOT,
  visualArtifactPath,
} from "../src/paths.ts";

describe("derived path constants", () => {
  it("composes VISUAL_VERIFICATIONS_ROOT from FRAMELIA_DIR + VISUAL_VERIFICATIONS_DIR", () => {
    expect(VISUAL_VERIFICATIONS_ROOT).toBe(`${FRAMELIA_DIR}/${VISUAL_VERIFICATIONS_DIR}`);
  });

  it("composes DEFAULT_DISCOVERY_DIR from FRAMELIA_DIR + DISCOVERY_DIR_NAME", () => {
    expect(DEFAULT_DISCOVERY_DIR).toBe(`${FRAMELIA_DIR}/${DISCOVERY_DIR_NAME}`);
  });

  it("composes DEFAULT_AUTH_STATE_PATH from FRAMELIA_DIR + AUTH_STATE_RELATIVE_PATH", () => {
    expect(DEFAULT_AUTH_STATE_PATH).toBe(`${FRAMELIA_DIR}/${AUTH_STATE_RELATIVE_PATH}`);
  });

  it("has the expected literal values", () => {
    expect(FRAMELIA_DIR).toBe(".framelia");
    expect(VISUAL_VERIFICATIONS_DIR).toBe("visual-verifications");
    expect(VISUAL_CONTRACT_FILE).toBe("visual-contract.json");
    expect(VISUAL_VERIFICATION_FILE).toBe("visual-verification.json");
    expect(DISCOVERY_DIR_NAME).toBe(".discovery");
  });
});

describe("visualArtifactPath", () => {
  it("joins segments under the visual-verifications root", () => {
    expect(visualArtifactPath("home")).toBe(`${VISUAL_VERIFICATIONS_ROOT}/home`);
  });

  it("joins multiple segments", () => {
    expect(visualArtifactPath("home", "hero")).toBe(`${VISUAL_VERIFICATIONS_ROOT}/home/hero`);
  });

  it("returns just the root when given no segments", () => {
    expect(visualArtifactPath()).toBe(VISUAL_VERIFICATIONS_ROOT);
  });
});

describe("VISUAL_ARTIFACT_DIR_PATTERN", () => {
  it("accepts the default visualArtifactPath output", () => {
    expect(VISUAL_ARTIFACT_DIR_PATTERN.test(visualArtifactPath("home"))).toBe(true);
  });

  it("accepts a nested subpath under the root", () => {
    expect(VISUAL_ARTIFACT_DIR_PATTERN.test(`${VISUAL_VERIFICATIONS_ROOT}/home/nested`)).toBe(true);
  });

  it("rejects the bare root with no subpath", () => {
    expect(VISUAL_ARTIFACT_DIR_PATTERN.test(VISUAL_VERIFICATIONS_ROOT)).toBe(false);
  });

  it("rejects an absolute path", () => {
    expect(VISUAL_ARTIFACT_DIR_PATTERN.test(`/${VISUAL_VERIFICATIONS_ROOT}/home`)).toBe(false);
  });

  it("rejects a path outside the visual-verifications root", () => {
    expect(VISUAL_ARTIFACT_DIR_PATTERN.test("some/other/dir")).toBe(false);
  });

  it("rejects a backslash anywhere in the path", () => {
    expect(VISUAL_ARTIFACT_DIR_PATTERN.test(`${VISUAL_VERIFICATIONS_ROOT}\\home`)).toBe(false);
  });

  it("rejects a path-traversal segment", () => {
    expect(VISUAL_ARTIFACT_DIR_PATTERN.test(`${VISUAL_VERIFICATIONS_ROOT}/../escape`)).toBe(false);
  });

  it("rejects a path-traversal segment nested deeper", () => {
    expect(VISUAL_ARTIFACT_DIR_PATTERN.test(`${VISUAL_VERIFICATIONS_ROOT}/home/../escape`)).toBe(
      false,
    );
  });
});
