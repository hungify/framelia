export {
  FIGMA_NODE_ID,
  MAX_CONTRACTS_PER_REQUEST,
  MAX_CONTRACT_TIMEOUT_MS,
  MAX_MASK_SELECTORS,
  MAX_STABILITY_SAMPLES,
  MIN_CONTRACTS_PER_REQUEST,
  MIN_CONTRACT_TIMEOUT_MS,
  MIN_STABILITY_SAMPLES,
  SCHEMA_VERSION,
} from "@framelia/contracts";

export const JSON_INDENT_SPACES = 2;

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export const EXIT_OK = 0;
export const EXIT_VISUAL_FAIL = 1;
export const EXIT_USAGE_ERROR = 2;
export const EXIT_PREFLIGHT_FAILED = 3;

export const DEVICE_SCALE_FACTOR = 1;
export const DEFAULT_CAPTURE_TIMEOUT_MS = 60 * MS_PER_SECOND;
// Matches the standalone TanStack Query/Router devtools' class/id naming ("tsqd-*",
// "tsrd-*", still used by their panel content when embedded via the unified shell
// below), the unified @tanstack/react-devtools shell's own trigger/panel host
// (`data-testid="tanstack_devtools"`), and Next.js's dev overlay, which mounts as a
// <nextjs-portal> custom element inside a shadow root — screenshot({ style }) pierces
// that natively. Projects using a different devtool (or a renamed one) should
// override via devtoolsSelector.
export const DEFAULT_DEVTOOLS_SELECTOR =
  '[class*="tsqd" i], [id*="tsqd" i], [class*="tsrd" i], [id*="tsrd" i], [data-testid="tanstack_devtools"], nextjs-portal';
export const SELECTOR_TIMEOUT_MS = 15 * MS_PER_SECOND;
export const NETWORK_IDLE_BEST_EFFORT_MS = 5 * MS_PER_SECOND;
export const NETWORK_IDLE_BUFFER_MS = 300;
export const HTTP_REQUEST_TIMEOUT_MS = 30 * MS_PER_SECOND;

export const DEFAULT_STABILITY_SAMPLES_FINAL = 3;
export const DEFAULT_STABILITY_SAMPLES_DEV = 1;

export const DEFAULT_IMAGE_SCALE = 1;
export const NODE_META_CACHE_TTL_MS = MS_PER_MINUTE;
export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
} as const;
export const MIN_RETRY_AFTER_MS = MS_PER_SECOND;
export const MAX_RETRY_AFTER_MS = 60 * MS_PER_SECOND;
export const DEFAULT_RETRY_AFTER_MS = MS_PER_SECOND;

export const DEFAULT_MAX_BASELINE_AGE_DAYS = 14;
export const DEFAULT_MAX_SCORE_AGE_MS = 15 * MS_PER_MINUTE;
export const DEFAULT_MAX_BASELINE_AGE_MS = 24 * MS_PER_HOUR;
export const CLOCK_SKEW_MS = MS_PER_MINUTE;

export const EXPECT_SIZE_TOLERANCE_PX = 2;
export const RESIDUAL_CLUSTER_BLOCK = 80;
// Tighter than pixelmatch's documented default (0.2); this widens the diff
// bounding box, so avgDeltaE2000 below runs more often instead of being skipped.
export const PIXEL_THRESHOLD = 0.1;
export const CLUSTER_GRID = 4;
export const CLUSTER_SLACK = 0.02;
export const REAL_DIFF_RED_MIN = 200;
export const REAL_DIFF_GREEN_MAX = 80;
export const REAL_DIFF_BLUE_MAX = 80;
export const REAL_DIFF_ALPHA_MIN = 128;
export const BORDER_SAMPLE_STRIDE_DIVISOR = 50;
export const WHITE_RGBA: [number, number, number, number] = [255, 255, 255, 255];
export const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** The minimum TopIssue.severity that blocks the done gate once a contract's resolved
 *  styleGateEligible is true -- see done-gate/validate.ts. "low" (all style mismatches'
 *  current severity) means any style mismatch blocks; raising this constant narrows
 *  gating to more severe mismatches without touching call sites. */
export const STYLE_GATE_MIN_SEVERITY: keyof typeof SEVERITY_RANK = "low";
/** TopIssueKinds the style gate inspects -- includes "style-check-error" (see #35) so a
 *  broken/unresolvable style check blocks rather than silently passing while gated. */
export const STYLE_GATE_BLOCKING_KINDS = [
  "style-color",
  "style-typography",
  "style-check-error",
] as const;

export const FONT_SIZE_TOLERANCE_PX = 0.5;
export const LINE_HEIGHT_TOLERANCE_PX = 1;
export const LETTER_SPACING_TOLERANCE_PX = 0.1;
export const COLOR_CHANNEL_TOLERANCE = 2;
export const ALPHA_TOLERANCE = 0.01;

// compareStyles()'s own defaults -- overridable per-contract via styleToleranceOverrides.
// 2.3 is the commonly-cited CIEDE2000 "just noticeable difference" threshold.
export const STYLE_COLOR_DELTA_E_TOLERANCE = 2.3;
export const STYLE_SPACING_TOLERANCE_PX = 1;
export const BORDER_WIDTH_TOLERANCE_PX = 0.5;
export const GAP_TOLERANCE_PX = 1;
export const OPACITY_TOLERANCE = 0.01;
/** Shared px epsilon for box-shadow's offsetX/offsetY/blurRadius/spreadRadius -- its color
 *  component still uses STYLE_COLOR_DELTA_E_TOLERANCE, like every other color comparison. */
export const BOX_SHADOW_TOLERANCE_PX = 1;

/**
 * Warning text shared between the producer (phases.ts, capture/core.ts) and
 * the consumer that classifies warnings into diagnostics (report.ts).
 * Kept as constants, not re-derived by string matching, so a rename can't
 * silently desync the two and flip a verdict without a test noticing.
 */
export const MASKED_PASS_WARNING_PREFIX = "masked-pass:";
export const STYLE_GATE_SKIPPED_WARNING = "style-gate skipped: no computed style available.";
export const FONT_FALLBACK_WARNING = "font fallback: font policy warn allowed incomplete fonts";
/** classifyDiagnostics() matches on this prefix so a style-gate skip always gates blocking. */
export const STYLE_GATE_SKIPPED_PREFIX = "style-gate skipped";
