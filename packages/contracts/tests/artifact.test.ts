import { describe, expect, it } from "vitest";

import { verificationArtifactSchema } from "../src/artifact.ts";
import { SCHEMA_VERSION } from "../src/constants.ts";

const contract = (id: string) => ({
  id,
  name: `Contract ${id}`,
  baseline: { kind: "figma" as const, fileKey: "abc", nodeId: "123:45" },
  viewport: { preset: "desktop", width: 1440, height: 900 },
  scope: { kind: "page" as const, pageReason: "top-level page" },
});

const request = (ids: string[]) => ({
  schemaVersion: SCHEMA_VERSION,
  target: { kind: "web" as const, url: "https://example.com" },
  contracts: ids.map(contract),
});

const result = (id: string, ok = true, pass = true) => ({
  id,
  ok,
  pass,
  outDir: `.framelia/visual-verifications/${id}`,
});

function artifact(ids: string[], overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "framelia.visual-verification" as const,
    createdAt: "2026-09-01T00:00:00.000Z",
    projectRoot: "/tmp/project",
    request: request(ids),
    ok: true,
    allPassed: true,
    results: ids.map((id) => result(id)),
    ...overrides,
  };
}

describe("verificationArtifactSchema", () => {
  it("round-trips a minimal valid artifact", () => {
    const value = artifact(["home"]);
    const parsed = verificationArtifactSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind).toBe("framelia.visual-verification");
    expect(parsed.success && parsed.data.ok).toBe(true);
    expect(parsed.success && parsed.data.allPassed).toBe(true);
    expect(parsed.success && parsed.data.results).toEqual(value.results);
    expect(parsed.success && parsed.data.request.contracts.map((c) => c.id)).toEqual(["home"]);
  });

  it("round-trips a multi-contract artifact with results covering every contract", () => {
    expect(verificationArtifactSchema.safeParse(artifact(["home", "about"])).success).toBe(true);
  });

  it("rejects a schemaVersion other than the current SCHEMA_VERSION", () => {
    expect(
      verificationArtifactSchema.safeParse(
        artifact(["home"], { schemaVersion: SCHEMA_VERSION - 1 }),
      ).success,
    ).toBe(false);
  });

  it("rejects an unknown top-level field (strict)", () => {
    expect(verificationArtifactSchema.safeParse(artifact(["home"], { extra: 1 })).success).toBe(
      false,
    );
  });

  describe("superRefine invariants", () => {
    it("flags a result with no matching request contract", () => {
      const value = artifact(["home"]);
      value.results = [result("home"), result("orphan")];
      const parsed = verificationArtifactSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("expected failure");
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["results", 1, "id"],
          message: "result has no matching contract: orphan",
        }),
      );
    });

    it("flags a duplicate result id", () => {
      const value = artifact(["home"]);
      value.results = [result("home"), result("home")];
      const parsed = verificationArtifactSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("expected failure");
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["results", 1, "id"],
          message: "duplicate result id: home",
        }),
      );
    });

    it("flags incomplete coverage: fewer results than request contracts", () => {
      const value = artifact(["home", "about"]);
      value.results = [result("home")];
      const parsed = verificationArtifactSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("expected failure");
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["results"],
          message: "results must cover every request contract exactly once",
        }),
      );
    });

    it("flags ok=true when a result failed structurally (ok mismatch)", () => {
      const value = artifact(["home"]);
      value.results = [result("home", false, false)];
      const parsed = verificationArtifactSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("expected failure");
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["ok"],
          message: "ok must equal the aggregate result status",
        }),
      );
    });

    it("accepts ok=false when a result failed structurally", () => {
      const value = artifact(["home"], { ok: false, allPassed: false });
      value.results = [result("home", false, false)];
      expect(verificationArtifactSchema.safeParse(value).success).toBe(true);
    });

    it("flags allPassed=true when a result is ok but did not visually pass", () => {
      const value = artifact(["home"]);
      value.results = [result("home", true, false)];
      const parsed = verificationArtifactSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("expected failure");
      expect(parsed.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["allPassed"],
          message: "allPassed must equal the aggregate visual verdict",
        }),
      );
    });

    it("accepts allPassed=false when a result is ok but did not visually pass", () => {
      const value = artifact(["home"], { allPassed: false });
      value.results = [result("home", true, false)];
      expect(verificationArtifactSchema.safeParse(value).success).toBe(true);
    });

    it("can raise multiple issues at once (orphan result + ok mismatch)", () => {
      const value = artifact(["home"]);
      value.results = [result("home", false, false), result("orphan", false, false)];
      const parsed = verificationArtifactSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (parsed.success) throw new Error("expected failure");
      expect(parsed.error.issues.length).toBeGreaterThan(1);
    });
  });
});
