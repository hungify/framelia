export const SCHEMA_VERSION = 4 as const;
export const MIN_CONTRACTS_PER_REQUEST = 1;
export const MAX_CONTRACTS_PER_REQUEST = 8;
export const MIN_CONTRACT_TIMEOUT_MS = 1_000;
export const MAX_CONTRACT_TIMEOUT_MS = 120_000;
export const MIN_STABILITY_SAMPLES = 2;
export const MAX_STABILITY_SAMPLES = 5;
export const MAX_MASK_SELECTORS = 10;
export const DEFAULT_MAX_MASKED_AREA_RATIO = 0.15;
export const MAX_COOKIES = 20;
export const MAX_NAVIGATION_ACTIONS = 40;
export const CONTRACT_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Figma node id: plain "123:45", or instance-swapped "I123:45;67:89". */
export const FIGMA_NODE_ID = /^(?:I\d+:\d+(?:;\d+:\d+)+|\d+:\d+)$/;
