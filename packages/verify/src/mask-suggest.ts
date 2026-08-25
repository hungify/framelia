import type { Page } from "@playwright/test";

/** One convention-based signal `suggestMasks` scans the DOM for -- see
 *  DEFAULT_MASK_SUGGESTION_HEURISTICS for the built-in set. */
export interface MaskSuggestionHeuristic {
  /** Stable identifier a caller can filter/report on (e.g. dashboard grouping). */
  kind: string;
  /** Human-readable reason surfaced on every suggestion this heuristic produces. */
  description: string;
  /** CSS selector this heuristic scans the page for. */
  selector: string;
}

export interface MaskSuggestion {
  /** A selector usable directly as a contract's `masks[].selector` -- prefers a
   *  matched element's own `data-testid`/`id` when present, falling back to the
   *  heuristic's own selector (grouping every unlabeled match under one
   *  suggestion with `maxMatches` set to the match count) otherwise. */
  selector: string;
  reason: string;
  heuristic: string;
  matchedCount: number;
  /** Set only when `selector` is the heuristic's own (possibly multi-match)
   *  selector, not a match's own unique id/data-testid -- mirrors
   *  `VisualMask.maxMatches`, which likewise defaults to 1 when unset. */
  maxMatches?: number;
}

/**
 * Convention-based dynamic-content signals worth masking in a visual diff --
 * mirrors Percy/Playwright's own auto-masking conventions (timestamps, avatars,
 * ad slots) plus the two this repo's issue #42 named explicitly (`<time>`,
 * `[data-dynamic]`). Deliberately small and selector-based (not a generic
 * heuristic engine) -- add an entry here when a new convention proves common
 * enough to warrant one, not speculatively.
 */
export const DEFAULT_MASK_SUGGESTION_HEURISTICS: readonly MaskSuggestionHeuristic[] = [
  {
    kind: "time-element",
    description: "<time> elements render a timestamp that changes between runs.",
    selector: "time",
  },
  {
    kind: "data-dynamic",
    description: "Element opts into the [data-dynamic] convention for non-deterministic content.",
    selector: "[data-dynamic]",
  },
  {
    kind: "avatar-image",
    description: "Image looks like a user avatar (varies per account/session).",
    selector:
      '[data-testid*="avatar" i], img[alt*="avatar" i], img[src*="avatar" i], img[class*="avatar" i]',
  },
  {
    kind: "ad-slot",
    description: "Element looks like a third-party ad slot (content varies per impression).",
    selector:
      '[data-testid*="-ad-" i], [data-testid$="-ad" i], [id*="google_ads" i], [class*="advertisement" i], ins.adsbygoogle',
  },
  {
    kind: "aria-live-region",
    description: "[aria-live] marks a region as updating asynchronously after render.",
    selector: "[aria-live]",
  },
] as const;

interface RawMatch {
  selector: string | null;
  isSpecific: boolean;
}

/**
 * Scans an already-navigated, already-settled Page (see suggest-masks.ts's
 * suggestMasksForUrl, which runs the same readiness pipeline captureReadyPage
 * uses before calling this) for DEFAULT_MASK_SUGGESTION_HEURISTICS' signals,
 * proposing a mask selector per finding. Never writes anything -- purely a
 * read; the caller decides whether to accept a suggestion into a contract.
 */
export async function suggestMasks(
  page: Page,
  heuristics: readonly MaskSuggestionHeuristic[] = DEFAULT_MASK_SUGGESTION_HEURISTICS,
): Promise<MaskSuggestion[]> {
  const suggestions: MaskSuggestion[] = [];
  for (const heuristic of heuristics) {
    // Sequential by design: one evaluate() round-trip per heuristic keeps each
    // heuristic's DOM query isolated and easy to attribute if one throws.
    // eslint-disable-next-line no-await-in-loop
    const matches = await page.evaluate((selector): RawMatch[] => {
      return Array.from(document.querySelectorAll(selector)).map((element) => {
        const testId = element.getAttribute("data-testid");
        if (testId)
          return {
            selector: `:is(${selector})[data-testid="${CSS.escape(testId)}"]`,
            isSpecific: true,
          };
        if (element.id)
          return { selector: `:is(${selector})#${CSS.escape(element.id)}`, isSpecific: true };
        return { selector: null, isSpecific: false };
      });
    }, heuristic.selector);
    if (!matches.length) continue;

    const specificCounts = new Map<string, number>();
    let genericCount = 0;
    for (const match of matches) {
      if (match.isSpecific && match.selector) {
        specificCounts.set(match.selector, (specificCounts.get(match.selector) ?? 0) + 1);
      } else {
        genericCount += 1;
      }
    }
    for (const [selector, count] of specificCounts) {
      suggestions.push({
        selector,
        reason: heuristic.description,
        heuristic: heuristic.kind,
        matchedCount: count,
        // A "specific" selector (data-testid/id) is only actually unique when it
        // matched once -- the same attribute value can repeat across elements (a
        // list rendered from a static testid, a duplicated id), so this must
        // report the real count and maxMatches, not assume 1 (PR #51 review).
        ...(count > 1 ? { maxMatches: count } : {}),
      });
    }
    if (genericCount > 0) {
      suggestions.push({
        selector: heuristic.selector,
        reason: heuristic.description,
        heuristic: heuristic.kind,
        matchedCount: genericCount,
        ...(genericCount > 1 ? { maxMatches: genericCount } : {}),
      });
    }
  }
  return suggestions;
}
