import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalJsonDigest } from "../src/canonical-json.ts";

describe("canonical JSON identity", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const first = {
      z: [{ second: 2, first: 1 }, "tail"],
      a: { y: true, x: null },
    };
    const sameMeaning = {
      a: { x: null, y: true },
      z: [{ first: 1, second: 2 }, "tail"],
    };

    expect(canonicalJson(first)).toBe(
      '{"a":{"x":null,"y":true},"z":[{"first":1,"second":2},"tail"]}',
    );
    expect(canonicalJsonDigest(first)).toBe(canonicalJsonDigest(sameMeaning));
    expect(canonicalJsonDigest({ ...first, z: first.z.toReversed() })).not.toBe(
      canonicalJsonDigest(first),
    );
  });

  it("returns an algorithm-tagged lowercase digest", () => {
    expect(canonicalJsonDigest({ contract: "login.desktop" })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("rejects values JSON cannot represent deterministically", () => {
    expect(() => canonicalJson({ value: Number.POSITIVE_INFINITY })).toThrow(
      "Canonical JSON cannot encode non-finite numbers.",
    );
  });
});
