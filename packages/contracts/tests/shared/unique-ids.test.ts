import { describe, expect, it } from "vitest";
import * as z from "zod";

import { assertUniqueIds } from "../../src/shared/unique-ids.ts";

/** Minimal schema wrapping assertUniqueIds so we exercise it exactly the way
 * request.ts/artifact.ts do -- through a real .superRefine() pass. */
function itemsSchema() {
  return z.object({ items: z.array(z.object({ id: z.string() })) }).superRefine((value, ctx) => {
    assertUniqueIds(value.items, (item) => item.id, ctx, {
      path: (index) => ["items", index, "id"],
      message: (id) => `duplicate id: ${id}`,
    });
  });
}

describe("assertUniqueIds", () => {
  it("passes when every id is unique", () => {
    const result = itemsSchema().safeParse({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    expect(result.success).toBe(true);
  });

  it("flags a repeated id at the second (and later) occurrence, not the first", () => {
    const result = itemsSchema().safeParse({
      items: [{ id: "a" }, { id: "b" }, { id: "a" }],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      path: ["items", 2, "id"],
      message: "duplicate id: a",
    });
  });

  it("flags every duplicate occurrence past the first, in order", () => {
    const result = itemsSchema().safeParse({
      items: [{ id: "a" }, { id: "a" }, { id: "a" }],
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ["items", 1, "id"],
      ["items", 2, "id"],
    ]);
  });

  it("returns the full set of ids encountered, for callers that need it", () => {
    const ctx: Pick<z.RefinementCtx, "addIssue"> = { addIssue: () => {} };
    const seen = assertUniqueIds(
      [{ id: "a" }, { id: "b" }, { id: "a" }],
      (item) => item.id,
      ctx as z.RefinementCtx,
      { path: (index) => ["x", index], message: (id) => id },
    );
    expect(seen).toEqual(new Set(["a", "b"]));
  });

  it("handles an empty array without reporting anything", () => {
    const result = itemsSchema().safeParse({ items: [] });
    expect(result.success).toBe(true);
  });
});
