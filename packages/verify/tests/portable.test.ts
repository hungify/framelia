import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { sanitizePortableValue } from "../src/portable.ts";

describe("sanitizePortableValue", () => {
  it("sanitizes strings through nested objects and arrays with deterministic key order", () => {
    const root = path.resolve("/writer/project");
    const portable = sanitizePortableValue(
      {
        z: [`at ${root}/src/page.ts`, { z: `${root}/z`, a: `${root}/a` }],
        a: { z: `${root}/nested`, a: "safe" },
      },
      root,
    );

    expect(Object.keys(portable)).toEqual(["a", "z"]);
    expect(Object.keys(portable.a)).toEqual(["a", "z"]);
    expect(Object.keys(portable.z[1]!)).toEqual(["a", "z"]);
    expect(portable).toEqual({
      a: { a: "safe", z: "<project-root>/nested" },
      z: ["at <project-root>/src/page.ts", { a: "<project-root>/a", z: "<project-root>/z" }],
    });
    expect(JSON.stringify(portable)).not.toContain(root);
  });
});
