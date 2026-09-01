import { CONTRACT_ID_PATTERN, type StyleCheckPoint, type VisualMask } from "@framelia/contracts";
import type {
  DiffCluster,
  ExpectSize,
  SelectorBounds,
  StyleSnapshot,
  TopIssue,
  ProfileOverrides,
  StyleToleranceOverrides,
} from "@framelia/verify";
import {
  attributeDiffRegions,
  compare,
  compareStyles,
  expectStyleToSnapshot,
  FigmaBaselineProvider,
} from "@framelia/verify";
import type { ExpectMatcherState, MatcherReturnType, Page } from "@playwright/test";
import { test } from "@playwright/test";

import {
  attachDiffTriplet,
  sanitizeAttachmentBaseName,
  SCORE_ATTACHMENT_SUFFIX,
  type AttachJsonFn,
} from "../attach.ts";
import { captureElementBounds, captureElementStyle } from "../capture-style.ts";
import { captureActual } from "../capture.ts";
import { resolveFigmaCompareOptions } from "../figma-profile.ts";
import { buildScoreAttachment, type FrameliaScoreAttachment } from "../score-attachment.ts";
import { withTimeout } from "../timeout.ts";

/**
 * Style comparison is best-effort and informational-only (see compareStyles):
 * a capture-style failure (stale selector, detached element, or a timeout --
 * see withStyleCheckTimeout) must never fail the match itself. It still must
 * not look identical to a clean pass, though -- a silently empty result is
 * indistinguishable from "checked and found nothing wrong" -- so a failure
 * reports itself as a single non-blocking diagnostic issue instead of
 * skipping the style issues for this run.
 */
function styleCheckErrorIssue(message: string): TopIssue {
  return {
    severity: "low",
    kind: "style-check-error",
    message,
    repairCandidate: false,
    blocking: false,
  };
}

async function captureStyleIssues(
  page: Page,
  selector: string,
  figmaStyle: StyleSnapshot,
  styleToleranceOverrides: StyleToleranceOverrides | undefined,
): Promise<TopIssue[]> {
  try {
    const actualStyle = await captureElementStyle(page, selector);
    return compareStyles(figmaStyle, actualStyle, styleToleranceOverrides);
  } catch (error) {
    return [
      styleCheckErrorIssue(
        `style check for "${selector}" could not run: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }
}

/**
 * Bounds one style comparison (region's single selector, or one page check-point --
 * see captureCheckPointStyleIssues, which calls this per check-point rather than once
 * for the whole batch, so a timeout on one check-point can't erase every other
 * check-point's diagnostics) by the matcher's own timeoutMs -- a stale or missing
 * selector's page.$eval has no timeout of its own and can otherwise hang past the
 * matcher's configured timeout, delaying score and image attachment. A timeout here
 * reports the same non-blocking style-check-error diagnostic as captureStyleIssues'
 * own catch above -- see it for why an empty result isn't safe.
 */
async function withStyleCheckTimeout(
  work: Promise<TopIssue[]>,
  timeoutMs: number,
): Promise<TopIssue[]> {
  try {
    return await withTimeout(work, timeoutMs, "toMatchFigma style check");
  } catch (error) {
    return [styleCheckErrorIssue(error instanceof Error ? error.message : String(error))];
  }
}

/**
 * Page-scope equivalent of the region-scope bake-in above: one style comparison per
 * declared check-point, each against its own baked `expectStyle` (there's no live
 * per-checkpoint Figma baseline to re-fetch at verify time -- see #26/#27). A
 * check-point whose `expectStyle` never baked at authoring time is skipped rather
 * than compared against nothing. Every resulting issue is tagged with the
 * check-point's own selector so multiple check-points stay distinguishable in
 * `topIssues` (see TopIssue.selector). The timeout is applied per check-point
 * (not once for the whole batch) so one slow/stale selector's timeout diagnostic
 * doesn't have to share a single deadline that could also starve its siblings --
 * and so its own diagnostic still gets tagged with its own selector below.
 */
/** A check-point only has something to compare (style or attribution bounds) once its
 *  `expectStyle` baked at authoring time -- shared by captureCheckPointStyleIssues and
 *  captureCheckPointBounds so both walk the same check-point population. */
function hasBakedExpectStyle(
  checkPoint: StyleCheckPoint,
): checkPoint is StyleCheckPoint & { expectStyle: NonNullable<StyleCheckPoint["expectStyle"]> } {
  return checkPoint.expectStyle !== undefined;
}

async function captureCheckPointStyleIssues(
  page: Page,
  checkPoints: StyleCheckPoint[],
  styleToleranceOverrides: StyleToleranceOverrides | undefined,
  timeoutMs: number,
): Promise<TopIssue[]> {
  const perCheckPoint = await Promise.all(
    checkPoints.filter(hasBakedExpectStyle).map(async (checkPoint) => {
      const issues = await withStyleCheckTimeout(
        captureStyleIssues(
          page,
          checkPoint.selector,
          expectStyleToSnapshot(checkPoint.expectStyle),
          styleToleranceOverrides,
        ),
        timeoutMs,
      );
      return issues.map((issue) => Object.assign({}, issue, { selector: checkPoint.selector }));
    }),
  );
  return perCheckPoint.flat();
}

/**
 * Page-scope selector bounds for every check-point with a baked expectStyle (the same
 * population captureCheckPointStyleIssues compares), captured in the same pixel space
 * as the page screenshot -- feeds attributeDiffRegions so a pixel-diff cluster can be
 * traced to the check-point(s) it overlaps. A selector that fails to resolve (stale,
 * detached, zero-size) is simply absent from the result rather than failing the batch --
 * see captureElementBounds.
 */
async function captureCheckPointBounds(
  page: Page,
  checkPoints: StyleCheckPoint[],
  fullPage: boolean,
  scale: number,
): Promise<SelectorBounds[]> {
  const bounds = await Promise.all(
    checkPoints
      .filter(hasBakedExpectStyle)
      .map((checkPoint) =>
        captureElementBounds(page, checkPoint.selector, fullPage, scale).catch(() => null),
      ),
  );
  return bounds.filter((b): b is SelectorBounds => b !== null);
}

/**
 * One TopIssue per (cluster, overlapping selector) pair -- mirrors how a style
 * mismatch is tagged with exactly one selector (see TopIssue.selector) so a region
 * overlapping two check-points surfaces as two distinguishable diagnostics instead of
 * one issue with an ambiguous multi-selector list. A cluster with no overlapping
 * selector contributes nothing -- left unattributed, not guessed.
 */
function buildAttributionIssues(clusters: DiffCluster[], selectors: SelectorBounds[]): TopIssue[] {
  return attributeDiffRegions(clusters, selectors).flatMap((region) =>
    region.selectors.map((selector) => ({
      severity: "low" as const,
      kind: "pixel-attribution" as const,
      message: `pixel-diff region (${region.pixels}px, bbox [${region.bbox.x0},${region.bbox.y0}]-[${region.bbox.x1},${region.bbox.y1}]) overlaps style check-point "${selector}"`,
      selector,
      repairCandidate: false,
      blocking: false,
    })),
  );
}

export interface ToMatchFigmaOptions {
  /** Figma file key. Falls back to FRAMELIA_FIGMA_FILE_KEY when omitted. */
  fileKey?: string;
  /** The caller's own contract id (e.g. "login.desktop" from a visual-contract.json read via
   *  readContractEntry). When set, the Reporter uses it as the durable artifact's id and
   *  evidence folder name instead of Playwright's opaque test.id hash. Must match
   *  CONTRACT_ID_PATTERN from @framelia/contracts -- same rule `framelia contract create`
   *  enforces on --contract-id, so a value copied from there always passes. */
  contractId?: string;
  /** Region scope when set (diffs only this selector's bounding box); page scope otherwise. */
  selector?: string;
  expectSize?: ExpectSize;
  fullPage?: boolean;
  masks?: VisualMask[];
  maxMaskedAreaRatio?: number;
  profile?: "page" | "component/strict" | "component/dev";
  /** Explicit per-contract threshold overrides, merged on top of the resolved profile's own defaults. */
  profileOverrides?: ProfileOverrides;
  /** Explicit per-contract style-comparison tolerance overrides, merged on top of compareStyles()'s own defaults. */
  styleToleranceOverrides?: StyleToleranceOverrides;
  /** Page-scope only: one style comparison per declared check-point, each against its own
   *  baked `expectStyle` (see #26). Ignored when `selector` is set (region scope). */
  styleChecks?: StyleCheckPoint[];
  /** Explicit override of whether this contract's resolved threshold blocks the CI merge
   *  gate; unset falls back to the resolved profile's own gateEligible default. */
  gateEligible?: boolean;
  /** Explicit override of whether style mismatches block the CI merge gate; unset falls back
   *  to the resolved profile's own styleGateEligible default (opt-in, default false). */
  styleGateEligible?: boolean;
  fontPolicy?: "required" | "warn";
  animationPolicy?: "freeze" | "allow";
  /** Hides dev-only overlays (TanStack Query/Router devtools, Next.js's dev overlay) before
   *  capture: `true` uses the built-in selector, or pass a custom CSS selector. */
  devtoolsSelector?: true | string;
  /** `true` captures and fetches the Figma baseline at the received Page's own live
   *  `devicePixelRatio` (rounded, capped at 4) instead of one PNG pixel per CSS px --
   *  sharper images and less anti-aliasing noise in the score. Unset (the default)
   *  captures at 1, unchanged from before this option existed -- an existing project
   *  whose `deviceScaleFactor` is already >1 for unrelated reasons (e.g. mobile-device
   *  emulation) sees no behavior change unless it opts in here. Always reads the
   *  context's actual `deviceScaleFactor` rather than taking a caller-supplied number,
   *  so the Figma fetch and the web capture can never drift out of sync with each
   *  other -- set `deviceScaleFactor` on the browser context (a Playwright setting, not
   *  a framelia one) to control the value this resolves to. */
  scale?: true;
}

export interface ToMatchFigmaContext {
  timeoutMs: number;
  workDir: string;
  /** Attaches a file at `path` under `name`; wraps TestInfo.attach in the real matcher. */
  attach: (name: string, path: string) => Promise<void>;
  attachJson: AttachJsonFn;
}

const FILE_KEY_ENV_VAR = "FRAMELIA_FIGMA_FILE_KEY";

/**
 * Runner-agnostic core: everything toMatchFigma does except reach into
 * Playwright's test-runner globals (`test.info()`, `this.timeout`). Split out
 * so it can run under Vitest without a live Playwright test context —
 * `test.info()` throws outside one, and playwright/test's `setCurrentTestInfo`
 * that fakes one is an unexported internal, which this project's "no internal
 * APIs" principle rules out using even for test scaffolding.
 */
export async function runToMatchFigma(
  received: Page,
  nodeId: string,
  options: ToMatchFigmaOptions,
  context: ToMatchFigmaContext,
): Promise<MatcherReturnType> {
  const { timeoutMs, workDir } = context;
  const fileKey = options.fileKey ?? process.env[FILE_KEY_ENV_VAR];
  if (!fileKey) {
    return {
      pass: false,
      message: () =>
        `toMatchFigma: no Figma file key. Pass { fileKey } or set ${FILE_KEY_ENV_VAR}.`,
    };
  }

  // Fail fast here instead of in the Reporter, where a bad contractId would only log to the
  // console and silently drop the evidence without failing the test.
  if (options.contractId !== undefined && !CONTRACT_ID_PATTERN.test(options.contractId)) {
    return {
      pass: false,
      message: () =>
        `toMatchFigma: contractId "${options.contractId}" must match ${CONTRACT_ID_PATTERN} ` +
        `(lowercase letters/digits, separated by "." or "-" -- e.g. "login.desktop").`,
    };
  }

  const baseName = sanitizeAttachmentBaseName(nodeId);
  const { profile, clusterCheck } = resolveFigmaCompareOptions(
    options.profile,
    Boolean(options.selector),
  );
  const startedAt = Date.now();
  // scale is opt-in (see ToMatchFigmaOptions.scale) and, when on, always reads the
  // context's own live devicePixelRatio rather than trusting a caller-supplied number --
  // that's what keeps the Figma fetch and the web capture from drifting out of sync.
  const scale = options.scale
    ? Math.min(4, Math.max(1, Math.round(await received.evaluate(() => window.devicePixelRatio))))
    : 1;

  try {
    const [baselineOutcome, captureOutcome] = await withTimeout(
      Promise.all([
        new FigmaBaselineProvider().resolve({
          source: { kind: "figma", fileKey, nodeId, scale },
          outDir: workDir,
          profile,
          stabilitySamples: 1,
          defaults: {},
        }),
        captureActual(received, {
          outPath: `${workDir}/actual.png`,
          selector: options.selector,
          expectedSize: options.expectSize,
          fullPage: options.fullPage,
          masks: options.masks,
          maxMaskedAreaRatio: options.maxMaskedAreaRatio,
          scale,
          timeoutMs,
          fontPolicy: options.fontPolicy,
          animationPolicy: options.animationPolicy,
          devtoolsSelector: options.devtoolsSelector,
        }),
      ]),
      timeoutMs,
      "toMatchFigma",
    );

    if (!baselineOutcome.ok) {
      return {
        pass: false,
        message: () =>
          `toMatchFigma: Figma baseline fetch failed (${baselineOutcome.error}): ${baselineOutcome.message}`,
      };
    }
    if (!captureOutcome.ok) {
      return {
        pass: false,
        message: () =>
          `toMatchFigma: capture failed (${captureOutcome.error}): ${captureOutcome.message}`,
      };
    }

    const actualPath = captureOutcome.capturePaths[0]!;
    const outcome = compare(baselineOutcome.baseline.evidence.path, actualPath, workDir, {
      profile,
      clusterCheck,
      profileOverrides: options.profileOverrides,
      maskBounds: captureOutcome.maskEvidence?.bounds,
    });

    // Region scope (selector set) -- style comparison needs a single element to
    // capture computed style from, and only applies when the Figma baseline fetch
    // was fresh enough to have extracted one (see ResolvedBaseline). Page scope
    // (no selector) instead runs one comparison per declared check-point, each
    // against its own baked expectStyle rather than the page's own Figma baseline
    // (see #27) -- gated on `!options.selector` so a region call whose baseline
    // fetch didn't yield a figmaStyle can never fall through into check-point
    // diagnostics that don't belong to it.
    //
    // Bounded by what's left of timeoutMs after the baseline+capture race above,
    // not a fresh timeoutMs window -- reusing the full budget here would let the
    // matcher run up to 2x its configured timeout before returning, which could
    // blow past Playwright's own enforced test/expect timeout instead of failing
    // gracefully with our own message (see review on #32).
    const styleCheckTimeoutMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    const styleIssues = options.selector
      ? baselineOutcome.baseline.figmaStyle
        ? await withStyleCheckTimeout(
            captureStyleIssues(
              received,
              options.selector,
              baselineOutcome.baseline.figmaStyle,
              options.styleToleranceOverrides,
            ),
            styleCheckTimeoutMs,
          )
        : []
      : options.styleChecks
        ? await captureCheckPointStyleIssues(
            received,
            options.styleChecks,
            options.styleToleranceOverrides,
            styleCheckTimeoutMs,
          )
        : [];
    // Root-cause linkage (page scope only, same gating as styleIssues above): cross-
    // references pixel-diff clusters against check-point selector bounds so a diff
    // region can be traced to the style check(s) it overlaps. Skipped when there's no
    // diff to attribute -- no point paying for a bounds capture round-trip on a clean
    // pass. Best-effort like styleIssues: a bounds-capture timeout or failure yields no
    // attribution rather than failing the matcher.
    //
    // Recomputed from startedAt rather than reusing styleCheckTimeoutMs -- styleIssues
    // above can itself consume most or all of that budget, and replaying the same
    // window here would let the matcher run up to 2x timeoutMs before returning (see
    // the styleCheckTimeoutMs comment above for why that's the wrong failure mode).
    const attributionTimeoutMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    const attributionIssues =
      !options.selector && options.styleChecks?.length && outcome.diffClusters.length
        ? buildAttributionIssues(
            outcome.diffClusters,
            await withTimeout(
              captureCheckPointBounds(received, options.styleChecks, options.fullPage ?? false, scale),
              attributionTimeoutMs,
              "toMatchFigma pixel attribution",
            ).catch(() => [] as SelectorBounds[]),
          )
        : [];
    // Style mismatches and pixel-attribution notes are informational-only
    // (TopIssue.blocking: false) and never affect `outcome.pass` -- merged in after
    // compare() decided pass/fail.
    const extraIssues = [...styleIssues, ...attributionIssues];
    const outcomeWithStyle = extraIssues.length
      ? { ...outcome, topIssues: [...outcome.topIssues, ...extraIssues] }
      : outcome;

    await attachDiffTriplet(context.attach, baseName, {
      expected: baselineOutcome.baseline.evidence.path,
      actual: actualPath,
      diff: outcome.diffPath,
    });
    const scoreAttachment: FrameliaScoreAttachment = {
      ...buildScoreAttachment(outcomeWithStyle, {
        targetUrl: received.url(),
        baselineKind: "figma",
        attachmentBaseName: baseName,
        profile,
        clusterCheck,
        profileOverrides: options.profileOverrides,
        gateEligible: options.gateEligible,
        styleGateEligible: options.styleGateEligible,
        scope: options.selector
          ? { kind: "region", selector: options.selector, expectedSize: options.expectSize }
          : { kind: "page", fullPage: options.fullPage ?? false },
        masks: options.masks,
        maxMaskedAreaRatio: options.maxMaskedAreaRatio,
        captureEvidence: captureOutcome,
        contractId: options.contractId,
      }),
      baselineFetchedAt: baselineOutcome.baseline.evidence.fetchedAt,
      baselineLastModified: baselineOutcome.baseline.evidence.lastModified,
      fileKey,
      nodeId,
    };
    await context.attachJson(`${baseName}${SCORE_ATTACHMENT_SUFFIX}`, scoreAttachment);

    return {
      pass: outcome.pass,
      message: () =>
        outcome.pass
          ? `toMatchFigma: ${nodeId} matched (matchRatio ${outcome.matchRatio?.toFixed(4)}).`
          : `toMatchFigma: ${nodeId} did not match Figma baseline (matchRatio ${outcome.matchRatio?.toFixed(4) ?? "n/a"}, ssim ${outcome.ssim?.toFixed(4) ?? "n/a"}). See attached expected/actual/diff.`,
    };
  } catch (error) {
    return {
      pass: false,
      message: () => `toMatchFigma: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * The registered matcher: thin Playwright-runner glue around {@link runToMatchFigma}.
 * `this: ExpectMatcherState` is Playwright's own expect.extend() contract, not an
 * import-bound `this` a bundler could drop — Playwright always invokes matchers with
 * `this` bound to ExpectMatcherState via its own dispatcher.
 */
export async function toMatchFigma(
  this: ExpectMatcherState,
  received: Page,
  nodeId: string,
  options: ToMatchFigmaOptions = {},
): Promise<MatcherReturnType> {
  const testInfo = test.info();
  // oxlint-disable-next-line no-this-in-exported-function -- see doc comment above.
  const timeoutMs = this.timeout;
  return runToMatchFigma(received, nodeId, options, {
    timeoutMs,
    workDir: testInfo.outputPath(sanitizeAttachmentBaseName(nodeId)),
    attach: (name, path) =>
      testInfo.attach(name, { path, contentType: "image/png" }).then(() => undefined),
    attachJson: (name, data) =>
      testInfo
        .attach(name, { body: JSON.stringify(data), contentType: "application/json" })
        .then(() => undefined),
  });
}
