import type * as z from "zod";

export interface AssertUniqueIdsOptions {
  path: (index: number) => Array<string | number>;
  message: (id: string) => string;
}

/**
 * Walks `items`, reporting (via `ctx.addIssue`) every item whose id -- as
 * computed by `getId` -- repeats one already seen earlier in the array.
 * Returns the full set of ids encountered, so a caller that also needs the
 * complete id set for a further check (e.g. artifact.ts's "results must
 * cover every request contract" coverage check) doesn't have to re-walk
 * `items` a second time.
 */
export function assertUniqueIds<T>(
  items: readonly T[],
  getId: (item: T) => string,
  ctx: z.RefinementCtx,
  options: AssertUniqueIdsOptions,
): Set<string> {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const id = getId(item);
    if (seen.has(id)) {
      ctx.addIssue({
        code: "custom",
        path: options.path(index),
        message: options.message(id),
      });
    }
    seen.add(id);
  });
  return seen;
}
