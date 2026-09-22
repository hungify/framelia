import * as path from "node:path";

/**
 * Recursively removes writer-machine roots from portable records. Object keys are sorted
 * so independently produced projections serialize deterministically.
 */
export function sanitizePortableValue<T>(value: T, roots: string | readonly string[]): T {
  const values = typeof roots === "string" ? [roots] : roots;
  const resolvedRoots = [...new Set(values.map((root) => path.resolve(root)))].toSorted(
    (left, right) => right.length - left.length || left.localeCompare(right),
  );
  const sanitize = (entry: unknown): unknown => {
    if (typeof entry === "string") {
      return resolvedRoots.reduce(
        (portable, root) => portable.replaceAll(root, "<project-root>"),
        entry,
      );
    }
    if (Array.isArray(entry)) return entry.map(sanitize);
    if (entry !== null && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry)
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, sanitize(nested)]),
      );
    }
    return entry;
  };
  return sanitize(value) as T;
}

export function portableErrorMessage(error: unknown, roots: string | readonly string[]): string {
  return sanitizePortableValue(error instanceof Error ? error.message : String(error), roots);
}
