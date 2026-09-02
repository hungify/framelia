import { describe, expect, it } from "vitest";

import { SCHEMA_VERSION } from "../src/constants.ts";
import { verificationRequestSchema } from "../src/request.ts";

const contract = (id: string) => ({
  id,
  name: `Contract ${id}`,
  baseline: { kind: "figma" as const, fileKey: "abc", nodeId: "123:45" },
  viewport: { preset: "desktop", width: 1440, height: 900 },
  scope: { kind: "page" as const, pageReason: "top-level page" },
});

const validRequest = {
  schemaVersion: SCHEMA_VERSION,
  target: { kind: "web" as const, url: "https://example.com" },
  contracts: [contract("home")],
};

describe("verificationRequestSchema", () => {
  it("round-trips a minimal valid request", () => {
    const result = verificationRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    expect(result.success && result.data.target).toEqual(validRequest.target);
    expect(result.success && result.data.contracts).toHaveLength(1);
  });

  it("round-trips a request at the max contract count (8)", () => {
    const contracts = Array.from({ length: 8 }, (_, i) => contract(`c${i}`));
    expect(verificationRequestSchema.safeParse({ ...validRequest, contracts }).success).toBe(true);
  });

  it("rejects an empty contracts array (below MIN_CONTRACTS_PER_REQUEST)", () => {
    expect(verificationRequestSchema.safeParse({ ...validRequest, contracts: [] }).success).toBe(
      false,
    );
  });

  it("rejects more than MAX_CONTRACTS_PER_REQUEST (8) contracts", () => {
    const contracts = Array.from({ length: 9 }, (_, i) => contract(`c${i}`));
    expect(verificationRequestSchema.safeParse({ ...validRequest, contracts }).success).toBe(false);
  });

  it("rejects a schemaVersion other than the current SCHEMA_VERSION", () => {
    expect(
      verificationRequestSchema.safeParse({ ...validRequest, schemaVersion: SCHEMA_VERSION - 1 })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown top-level field (strict)", () => {
    expect(verificationRequestSchema.safeParse({ ...validRequest, extra: 1 }).success).toBe(false);
  });

  it("superRefine: rejects duplicate contract ids", () => {
    const result = verificationRequestSchema.safeParse({
      ...validRequest,
      contracts: [contract("home"), contract("about"), contract("home")],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["contracts", 2, "id"],
        message: "duplicate contract id: home",
      }),
    );
  });

  it("superRefine: allows contracts with distinct ids", () => {
    const result = verificationRequestSchema.safeParse({
      ...validRequest,
      contracts: [contract("home"), contract("about")],
    });
    expect(result.success).toBe(true);
  });
});
