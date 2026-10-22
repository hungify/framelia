import { describe, expect, it } from "vitest";

import { schemaCommand } from "../src/internal/schema.ts";

describe("schemaCommand", () => {
  it("returns the authored contract JSON Schema for target 'contract'", () => {
    const schema = schemaCommand({ target: "contract" }).body;
    expect(schema.type).toBe("object");
    const properties = Object.keys(schema.properties ?? {});
    expect(properties).toEqual(
      expect.arrayContaining(["formatVersion", "kind", "id", "target", "viewport", "baseline"]),
    );
    expect(properties).not.toContain("schemaVersion");
  });

  it("returns the signed authoritative requirements envelope schema", () => {
    const schema = schemaCommand({ target: "requirements" }).body;
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["formatVersion", "kind", "payload", "signature"]),
    );
  });
});
