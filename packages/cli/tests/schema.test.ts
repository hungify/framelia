import { describe, expect, it } from "vitest";

import { schemaCommand } from "../src/internal/schema.ts";

describe("schemaCommand", () => {
  it("returns the contract (verification request) JSON Schema for target 'contract'", () => {
    const schema = schemaCommand({ target: "contract" }).body;
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["schemaVersion", "target", "contracts"]),
    );
  });

  it("returns the signed authoritative requirements envelope schema", () => {
    const schema = schemaCommand({ target: "requirements" }).body;
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["formatVersion", "kind", "payload", "signature"]),
    );
  });
});
