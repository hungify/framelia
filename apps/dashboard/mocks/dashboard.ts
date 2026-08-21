import type { DashboardContractResult, DashboardRun } from "@framelia/contracts";

// Sized to each contract's real capture viewport (not a fixed thumbnail size) so the
// dashboard's pan/zoom canvas can be exercised against the same overflow conditions a
// real 1440px+ desktop capture produces.
function screen(width: number, height: number, accent: string, offset = 0): string {
  const sx = width / 960;
  const sy = height / 540;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#f5f6f7"/>
    <g transform="scale(${sx} ${sy})">
      <rect x="0" y="0" width="960" height="52" fill="#202328"/>
      <rect x="28" y="18" width="94" height="16" rx="3" fill="#d9dde2"/>
      <rect x="758" y="18" width="72" height="16" rx="3" fill="#6f7781"/>
      <rect x="842" y="12" width="90" height="28" rx="4" fill="${accent}"/>
      <rect x="${94 + offset}" y="116" width="300" height="28" rx="4" fill="#2c3137"/>
      <rect x="${94 + offset}" y="158" width="410" height="12" rx="3" fill="#aeb5bd"/>
      <rect x="${94 + offset}" y="180" width="350" height="12" rx="3" fill="#c4c9cf"/>
      <rect x="${94 + offset}" y="232" width="772" height="218" rx="6" fill="#ffffff" stroke="#d9dde2"/>
      <rect x="${122 + offset}" y="264" width="230" height="18" rx="3" fill="#4d555e"/>
      <rect x="${122 + offset}" y="302" width="716" height="1" fill="#e4e7ea"/>
      <rect x="${122 + offset}" y="330" width="190" height="12" rx="3" fill="#aeb5bd"/>
      <rect x="${694 + offset}" y="322" width="144" height="30" rx="4" fill="${accent}"/>
    </g>
  </svg>`;
}

const paths = {
  checkout: {
    baseline: "mock/checkout-baseline.svg",
    actual: "mock/checkout-actual.svg",
    diff: "mock/checkout-diff.svg",
  },
  header: {
    baseline: "mock/header-baseline.svg",
    actual: "mock/header-actual.svg",
    diff: "mock/header-diff.svg",
  },
};

const CHECKOUT_SIZE = { width: 1440, height: 900 };
const HEADER_SIZE = { width: 390, height: 844 };

export const dashboardMockArtifacts: Record<string, string> = {
  [paths.checkout.baseline]: screen(CHECKOUT_SIZE.width, CHECKOUT_SIZE.height, "#4979d1"),
  [paths.checkout.actual]: screen(CHECKOUT_SIZE.width, CHECKOUT_SIZE.height, "#4979d1", 8),
  [paths.checkout.diff]: screen(CHECKOUT_SIZE.width, CHECKOUT_SIZE.height, "#d64f58", 8),
  [paths.header.baseline]: screen(HEADER_SIZE.width, HEADER_SIZE.height, "#4979d1"),
  [paths.header.actual]: screen(HEADER_SIZE.width, HEADER_SIZE.height, "#4979d1"),
  [paths.header.diff]: screen(HEADER_SIZE.width, HEADER_SIZE.height, "#90969e"),
};

const contracts: DashboardContractResult[] = [
  {
    id: "checkout.desktop",
    name: "Checkout · Desktop",
    tags: ["checkout", "desktop"],
    status: "failed",
    phase: "complete",
    baselineKind: "figma",
    baseline: {
      path: paths.checkout.baseline,
      provenance: "figma://demo/120:44",
      ...CHECKOUT_SIZE,
    },
    actual: {
      path: paths.checkout.actual,
      url: "http://127.0.0.1:3000/checkout",
      ...CHECKOUT_SIZE,
    },
    diff: { path: paths.checkout.diff, ...CHECKOUT_SIZE },
    capture: { kind: "viewport", viewport: { width: 1440, height: 900 } },
    comparison: {
      algorithm: "framelia-multi-signal",
      diffPixels: 6221,
      diffRatio: 0.012,
      matchRatio: 0.988,
      ssim: 0.972,
      avgDeltaE: 2.31,
      sizeMatch: true,
    },
    resolvedThreshold: {
      name: "page",
      minMatch: 0.99,
      maxDiffPixels: null,
      minSSIM: 0.97,
      maxAvgDeltaE: 4.0,
      maxAreaGapPercent: 5,
      cluster: true,
      stabilityMaxDiffRatio: 0.002,
    },
    blockers: [
      { code: "visual-diff", message: "Residual difference exceeds configured threshold." },
    ],
    evidenceHash: `sha256:${"b".repeat(64)}`,
  },
  {
    id: "checkout.header.mobile",
    name: "Checkout header · Mobile",
    tags: ["header", "mobile"],
    status: "passed",
    phase: "complete",
    baselineKind: "page",
    baseline: {
      path: paths.header.baseline,
      provenance: "https://example.com/main",
      ...HEADER_SIZE,
    },
    actual: { path: paths.header.actual, url: "http://127.0.0.1:3000", ...HEADER_SIZE },
    diff: { path: paths.header.diff, ...HEADER_SIZE },
    capture: {
      kind: "element",
      viewport: { width: 390, height: 844 },
      target: {
        definition: { kind: "css", value: '[data-testid="header"]' },
        matchCount: 1,
        stable: true,
      },
    },
    comparison: {
      algorithm: "framelia-multi-signal",
      diffPixels: 156,
      diffRatio: 0.0003,
      matchRatio: 0.9997,
      ssim: 0.998,
      avgDeltaE: 0.42,
      sizeMatch: true,
    },
    resolvedThreshold: {
      name: "component/strict",
      minMatch: 0.995,
      maxDiffPixels: 500,
      minSSIM: 0.985,
      maxAvgDeltaE: 3.0,
      maxAreaGapPercent: 2,
      cluster: false,
      stabilityMaxDiffRatio: 0.002,
    },
    blockers: [],
    evidenceHash: `sha256:${"a".repeat(64)}`,
  },
  {
    id: "checkout.mobile",
    name: "Checkout · Mobile",
    tags: ["checkout", "mobile"],
    status: "passed",
    phase: "complete",
    baselineKind: "page",
    baseline: {
      path: paths.header.baseline,
      provenance: "https://example.com/main",
      ...HEADER_SIZE,
    },
    actual: { path: paths.header.actual, url: "http://127.0.0.1:3000/checkout", ...HEADER_SIZE },
    diff: { path: paths.header.diff, ...HEADER_SIZE },
    capture: { kind: "viewport", viewport: { width: 390, height: 844 } },
    comparison: {
      algorithm: "framelia-multi-signal",
      diffPixels: 156,
      diffRatio: 0.0003,
      matchRatio: 0.9997,
      ssim: 0.998,
      avgDeltaE: 0.42,
      sizeMatch: true,
    },
    blockers: [],
    evidenceHash: `sha256:${"c".repeat(64)}`,
  },
  {
    id: "checkout.profile-card.desktop",
    name: "Checkout profile card · Desktop",
    tags: ["profile", "desktop"],
    status: "blocked",
    phase: "baseline",
    baselineKind: "figma",
    capture: {
      kind: "element",
      viewport: { width: 1440, height: 900 },
      target: {
        definition: { kind: "css", value: '[data-testid="profile-card"]' },
        matchCount: 0,
        stable: false,
      },
    },
    blockers: [{ code: "selector-not-found", message: "Selector matched no elements." }],
  },
];

const now = new Date().toISOString();

export const dashboardMockRun: DashboardRun = {
  schemaVersion: 1,
  runId: "dashboard-mock",
  suiteName: "Checkout",
  status: "failed",
  summary: { total: 4, queued: 0, running: 0, passed: 2, failed: 1, blocked: 1 },
  contracts,
  startedAt: now,
  updatedAt: now,
  finishedAt: now,
};
