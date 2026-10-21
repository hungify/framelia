import { describe, expect, it } from "vitest";
import * as z from "zod";

import {
  checkFormatVersion,
  describeSchemaIssues,
  formatVersionMismatchMessage,
  formatVersionSchema,
} from "../src/format-version.ts";
import { authoredContractSchema, runRecordSchema } from "../src/workflow-records.ts";

describe("checkFormatVersion", () => {
  it("returns undefined when the version matches", () => {
    expect(checkFormatVersion({ formatVersion: 2 }, { record: "run", supported: 2 })).toBe(
      undefined,
    );
  });

  it("leaves a missing or non-integer version to schema validation", () => {
    expect(checkFormatVersion({}, { record: "run", supported: 2 })).toBeUndefined();
    expect(checkFormatVersion(null, { record: "run", supported: 2 })).toBeUndefined();
    expect(checkFormatVersion({ formatVersion: "2" }, { record: "run", supported: 2 })).toBe(
      undefined,
    );
  });

  it("reports a newer writer as an upgrade hint", () => {
    const mismatch = checkFormatVersion(
      { schemaVersion: 3 },
      { record: "Dashboard run", field: "schemaVersion", supported: 2 },
    );
    expect(mismatch).toEqual({
      record: "Dashboard run",
      found: 3,
      supported: 2,
      direction: "newer",
    });
    expect(formatVersionMismatchMessage(mismatch!)).toBe(
      "Dashboard run was written by format v3, but this reader supports v2 — upgrade framelia to read it.",
    );
  });

  it("reports an older writer as a re-create/downgrade hint", () => {
    const mismatch = checkFormatVersion({ formatVersion: 1 }, { record: "run", supported: 2 });
    expect(mismatch?.direction).toBe("older");
    expect(formatVersionMismatchMessage(mismatch!)).toContain("downgrade framelia");
  });
});

describe("formatVersionSchema", () => {
  it("accepts exactly the supported version", () => {
    expect(formatVersionSchema(2, "framelia.run").parse(2)).toBe(2);
  });

  it("explains a version mismatch instead of a bare literal error", () => {
    const result = formatVersionSchema(2, "framelia.run").safeParse(5);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "framelia.run was written by format v5, but this reader supports v2 — upgrade framelia to read it.",
    );
  });

  it("is wired into the workflow records", () => {
    const result = runRecordSchema.safeParse({ formatVersion: 99, kind: "framelia.run" });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "framelia.run was written by format v99, but this reader supports v2 — upgrade framelia to read it.",
    );
  });
});

describe("describeSchemaIssues", () => {
  it("lists readable path: message lines and truncates long lists", () => {
    const schema = z.object({ a: z.string(), b: z.array(z.number()) });
    const result = schema.safeParse({ a: 1, b: ["x", "y", "z"] });
    expect(result.success).toBe(false);
    const text = describeSchemaIssues(result.error!, 2);
    expect(text.split("\n")).toEqual([
      expect.stringMatching(/^a: /),
      expect.stringMatching(/^b\[0\]: /),
      "…and 2 more issue(s)",
    ]);
  });

  it("labels a root-level issue", () => {
    const result = z.string().safeParse(1);
    expect(describeSchemaIssues(result.error!)).toMatch(/^\(root\): /);
  });
});

describe("authoredContractSchema masks", () => {
  it("caps masks at MAX_MASK_SELECTORS like the visual contract", () => {
    const mask = { selector: ".ad", reason: "rotating ad" };
    const result = authoredContractSchema.shape.masks.safeParse(
      Array.from({ length: 11 }, () => ({ ...mask })),
    );
    expect(result.success).toBe(false);
  });
});
