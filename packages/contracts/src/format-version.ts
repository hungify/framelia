import * as z from "zod";

/**
 * Versioned-record compatibility, owned in one place.
 *
 * Every durable Framelia record pins exactly one `formatVersion` (and the dashboard wire
 * format one `schemaVersion`). A bare `z.literal` mismatch reads as "Invalid input:
 * expected 2" -- true, but it doesn't tell the user that the fix is a different framelia
 * version. These helpers turn that case into an actionable message, and let a reader
 * pre-check the version before running the full schema (so a newer record's unrelated
 * shape changes don't bury the one issue that matters under dozens of others).
 */

export type FormatVersionField = "formatVersion" | "schemaVersion";

export interface FormatVersionMismatch {
  /** Human-readable record name, e.g. `framelia.run` or `Dashboard run`. */
  readonly record: string;
  readonly found: number;
  readonly supported: number;
  /** `newer`: written by a newer framelia than this reader; `older`: by an older one. */
  readonly direction: "newer" | "older";
}

export function formatVersionMismatchMessage(mismatch: FormatVersionMismatch): string {
  const hint =
    mismatch.direction === "newer"
      ? "upgrade framelia to read it."
      : "re-create it with this framelia version, or downgrade framelia to read it.";
  return `${mismatch.record} was written by format v${mismatch.found}, but this reader supports v${mismatch.supported} — ${hint}`;
}

/**
 * Returns the mismatch when `payload[field]` is an integer version other than
 * `supported`; `undefined` when it matches, or when the field is missing/malformed (that
 * is a shape problem the record's own schema reports, not a version problem).
 */
export function checkFormatVersion(
  payload: unknown,
  options: { record: string; supported: number; field?: FormatVersionField },
): FormatVersionMismatch | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const found = (payload as Record<string, unknown>)[options.field ?? "formatVersion"];
  if (typeof found !== "number" || !Number.isInteger(found) || found === options.supported)
    return undefined;
  return {
    record: options.record,
    found,
    supported: options.supported,
    direction: found > options.supported ? "newer" : "older",
  };
}

/**
 * `z.literal(supported)` whose mismatch issue explains the version skew (see
 * `formatVersionMismatchMessage`) instead of zod's generic literal error.
 */
export function formatVersionSchema<const Version extends number>(
  supported: Version,
  record: string,
) {
  return z.literal(supported, {
    error: (issue) =>
      typeof issue.input === "number" && Number.isInteger(issue.input)
        ? formatVersionMismatchMessage({
            record,
            found: issue.input,
            supported,
            direction: issue.input > supported ? "newer" : "older",
          })
        : undefined,
  });
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path
    .map((segment, index) =>
      typeof segment === "number" ? `[${segment}]` : `${index === 0 ? "" : "."}${String(segment)}`,
    )
    .join("");
}

/** One `path: message` line per issue (at most `maxIssues`), for user-facing errors. */
export function describeSchemaIssues(error: z.ZodError, maxIssues = 5): string {
  const lines = error.issues
    .slice(0, maxIssues)
    .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`);
  const remaining = error.issues.length - maxIssues;
  if (remaining > 0) lines.push(`…and ${remaining} more issue(s)`);
  return lines.join("\n");
}
