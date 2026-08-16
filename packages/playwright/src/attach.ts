export type AttachFn = (name: string, path: string) => Promise<void>;
/** Attaches structured JSON (not a file path) -- how each matcher hands its score data to the Reporter, which runs out-of-process and has no other way to see it. */
export type AttachJsonFn = (name: string, data: unknown) => Promise<void>;

/** Name every matcher's JSON score summary attaches under; the Reporter looks for this suffix. */
export const SCORE_ATTACHMENT_SUFFIX = "-framelia-score";

/**
 * Attaches expected/actual/diff images under the `-expected`/`-actual`/`-diff`
 * naming convention Playwright's HTML reporter groups into its native
 * image-diff viewer (`groupImageDiffs()`), regardless of how the attachment
 * was produced. Takes a plain attach function, not `TestInfo`, so the
 * calling matcher's diff logic can run outside a live Playwright test (see
 * `runToMatchFigma`'s doc comment).
 */
export async function attachDiffTriplet(
  attach: AttachFn,
  baseName: string,
  paths: { expected?: string | null; actual: string; diff?: string | null },
): Promise<void> {
  if (paths.expected) {
    await attach(`${baseName}-expected`, paths.expected);
  }
  await attach(`${baseName}-actual`, paths.actual);
  if (paths.diff) {
    await attach(`${baseName}-diff`, paths.diff);
  }
}

/** Filesystem/attachment-safe base name derived from a Figma node id or arbitrary label. */
export function sanitizeAttachmentBaseName(label: string): string {
  return `framelia-${label.replaceAll(/[^a-zA-Z0-9-]+/g, "-")}`;
}
