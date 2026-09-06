import { describe, expect, it } from "vitest";
import * as z from "zod";

import { toJsonSchema } from "../src/json-schema.ts";
import { verificationContractSchema } from "../src/visual-contract.ts";

describe("toJsonSchema", () => {
  it("produces a JSON Schema object for a plain schema", () => {
    const schema = z.object({ name: z.string() });
    const jsonSchema = toJsonSchema(schema);
    expect(jsonSchema).toMatchObject({ type: "object" });
  });

  /**
   * Pins the io: "input" choice explicitly. verificationContractSchema ends in a
   * .transform() (deriving outDir when omitted), and z.toJSONSchema()'s default
   * "output" mode cannot represent a transform at all -- it throws outright,
   * which would silently break `framelia schema` (the CLI command backed by
   * this function) the moment a future edit dropped the `io: "input"` option.
   * "input" describes what a contract author may write (outDir genuinely
   * optional), which is the only mode that both succeeds and matches what
   * `framelia schema`'s consumers actually need. This test fails loudly if
   * that option is ever removed or flipped -- there would otherwise be no
   * local signal for that regression.
   */
  it("pins io: 'input' so a transform's derived field stays optional in the emitted schema", () => {
    const jsonSchema = toJsonSchema(verificationContractSchema) as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(jsonSchema.properties).toHaveProperty("outDir");
    expect(jsonSchema.required ?? []).not.toContain("outDir");

    // Cross-check against zod's default ("output") mode: confirms it throws
    // outright rather than merely producing a different shape.
    expect(() => z.toJSONSchema(verificationContractSchema, { io: "output" })).toThrow(
      /transform/i,
    );
  });

  it("still requires the contract's genuinely-required fields", () => {
    const jsonSchema = toJsonSchema(verificationContractSchema) as { required?: string[] };
    expect(jsonSchema.required).toEqual(
      expect.arrayContaining(["id", "name", "baseline", "viewport", "scope"]),
    );
  });
});
