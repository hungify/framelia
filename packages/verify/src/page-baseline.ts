import * as fs from "node:fs";
import * as path from "node:path";

import { WEB_BASELINE_ARTIFACT } from "./artifacts.ts";
import { JSON_INDENT_SPACES } from "./constants.ts";
import { writeFileAtomic } from "./fs-atomic.ts";

const WEB_BASELINE_HISTORY_DIR = "web-baseline-history";

export interface PageBaselinePromotion {
  version: number;
  promotedAt: string;
  promotedBy: string;
  runId?: string;
  note?: string;
}

export interface PageBaselineMeta {
  current: PageBaselinePromotion;
  /** Prior promotions, oldest first -- each one's image stays recoverable under
   *  `web-baseline-history/vN.png` (see promotePageBaseline), so a promotion is
   *  never a silent, unrecoverable overwrite. */
  history: PageBaselinePromotion[];
}

export interface PromotePageBaselineOptions {
  /** Freshly captured PNG to accept as the new baseline. */
  sourcePath: string;
  outDir: string;
  promotedBy: string;
  runId?: string;
  note?: string;
}

export interface PromotePageBaselineResult {
  baselinePath: string;
  metaPath: string;
  meta: PageBaselineMeta;
  /** The previous version's own image path; unset on the first promotion. Nothing is
   *  copied to produce it -- every version already lives at its own immutable path
   *  (see promotePageBaseline) -- this just names where it already was. */
  archivedPath?: string;
}

export function pageBaselineMetaPath(outDir: string): string {
  return path.join(outDir, WEB_BASELINE_ARTIFACT.meta);
}

function pageBaselineHistoryDir(outDir: string): string {
  return path.join(outDir, WEB_BASELINE_HISTORY_DIR);
}

/** Where one specific promoted version's image lives -- immutable once written (see
 *  promotePageBaseline), so this is safe to call for any version meta.json has ever named. */
export function pageBaselineImagePath(outDir: string, version: number): string {
  return path.join(pageBaselineHistoryDir(outDir), `v${version}.png`);
}

export function readPageBaselineMeta(outDir: string): PageBaselineMeta | null {
  const metaPath = pageBaselineMetaPath(outDir);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf8")) as PageBaselineMeta;
  } catch {
    return null;
  }
}

/**
 * Accepts a freshly captured page as the new promoted baseline for
 * toMatchPageBaseline -- the accept/promote step toMatchFigma never needed
 * (Figma is always the live source of truth) but a page-to-page baseline has
 * no source of truth at all until someone explicitly promotes one.
 *
 * Every version's image is written once to its own immutable path
 * (`web-baseline-history/vN.png`) and never touched again -- there is no "current
 * baseline.png" file to overwrite in place. `meta.json` is the single pointer to
 * which version is active, and it only switches after that version's image is
 * durably on disk: a crash between the two can leave an orphaned, unreferenced
 * image behind, but can never leave the pointer referencing a missing image, or
 * mislabel one version's image with another's promotion record (see PR #50 review --
 * the prior scheme wrote a mutable `baseline.png` and archived it in place, which
 * could desync image and metadata on a crash between the two writes, and could then
 * silently corrupt an *already-archived* version on the next promotion).
 */
export function promotePageBaseline(
  options: PromotePageBaselineOptions,
): PromotePageBaselineResult {
  const metaPath = pageBaselineMetaPath(options.outDir);
  const historyDir = pageBaselineHistoryDir(options.outDir);
  fs.mkdirSync(historyDir, { recursive: true });

  const previousMeta = readPageBaselineMeta(options.outDir);
  const version = (previousMeta?.current.version ?? 0) + 1;
  const baselinePath = pageBaselineImagePath(options.outDir, version);

  const promotion: PageBaselinePromotion = {
    version,
    promotedAt: new Date().toISOString(),
    promotedBy: options.promotedBy,
    ...(options.runId ? { runId: options.runId } : {}),
    ...(options.note ? { note: options.note } : {}),
  };
  const meta: PageBaselineMeta = {
    current: promotion,
    history: previousMeta ? [...previousMeta.history, previousMeta.current] : [],
  };

  // Temp-file-then-rename into this version's own never-reused path first -- a crash
  // here just leaves an orphaned file; meta.json (read above) hasn't moved yet, so the
  // active pointer still names the last complete version. Only once this image is
  // durable does meta.json switch atomically to point at it.
  const temporaryImage = `${baselinePath}.${process.pid}.tmp`;
  fs.copyFileSync(options.sourcePath, temporaryImage);
  fs.renameSync(temporaryImage, baselinePath);
  writeFileAtomic(metaPath, `${JSON.stringify(meta, null, JSON_INDENT_SPACES)}\n`);

  return {
    baselinePath,
    metaPath,
    meta,
    ...(previousMeta
      ? { archivedPath: pageBaselineImagePath(options.outDir, previousMeta.current.version) }
      : {}),
  };
}

export type ResolvePageBaselineOutcome =
  | { ok: true; path: string; meta: PageBaselineMeta }
  | { ok: false; error: "BASELINE_NOT_FOUND"; message: string };

/**
 * Resolves the currently promoted baseline for toMatchPageBaseline. Unlike Figma's
 * always-live fetch, a page baseline only exists once someone has explicitly promoted
 * one (see promotePageBaseline) -- "no baseline yet" is a first-class, clearly
 * messaged outcome here, not an error class.
 */
export function resolvePageBaseline(outDir: string): ResolvePageBaselineOutcome {
  const meta = readPageBaselineMeta(outDir);
  if (!meta) {
    return {
      ok: false,
      error: "BASELINE_NOT_FOUND",
      message: `no promoted baseline found at ${outDir} -- run \`framelia baseline promote\` to accept the current state as the new baseline.`,
    };
  }
  const baselinePath = pageBaselineImagePath(outDir, meta.current.version);
  if (!fs.existsSync(baselinePath)) {
    return {
      ok: false,
      error: "BASELINE_NOT_FOUND",
      message: `promoted baseline metadata at ${outDir} points to v${meta.current.version}, but its image is missing -- run \`framelia baseline promote\` again.`,
    };
  }
  return { ok: true, path: baselinePath, meta };
}
