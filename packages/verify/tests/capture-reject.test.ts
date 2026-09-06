import { describe, expect, it } from "vitest";

import { reject } from "../src/capture/reject.ts";
import { SCHEMA_VERSION } from "../src/types.ts";

describe("reject", () => {
  it("builds a RejectResult carrying the given error/message and the current schema version", () => {
    const result = reject("SELECTOR_NOT_FOUND", "Selector matched 0 elements.");
    expect(result).toEqual({
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      error: "SELECTOR_NOT_FOUND",
      message: "Selector matched 0 elements.",
    });
  });

  it("never sets matchCount or maskEvidence -- callers that need those add them separately", () => {
    const result = reject("MASK_AREA_EXCEEDED", "too much masked.");
    expect(result).not.toHaveProperty("matchCount");
    expect(result).not.toHaveProperty("maskEvidence");
  });
});
