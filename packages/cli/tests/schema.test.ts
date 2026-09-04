import { describe, expect, it } from "vitest";

import { schemaCommand } from "../src/internal/schema.ts";

/**
 * Phase 3 (see the CLI v2 rewrite plan): `internal/schema.ts` is a pure function,
 * no runtime/context needed at all -- it just reflects a `@framelia/contracts` schema.
 */

describe("schemaCommand", () => {
  it("returns the contract (verification request) JSON Schema for target 'contract'", () => {
    const schema = schemaCommand({ target: "contract" }) as {
      type?: string;
      properties?: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["schemaVersion", "target", "contracts"]),
    );
  });

  it("returns the verification artifact JSON Schema for target 'artifact'", () => {
    const schema = schemaCommand({ target: "artifact" }) as {
      type?: string;
      properties?: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["schemaVersion", "kind", "request", "results"]),
    );
  });
});
