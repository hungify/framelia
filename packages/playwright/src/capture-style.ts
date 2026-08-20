import type { StyleSnapshot } from "@framelia/verify";
import type { Page } from "@playwright/test";

interface RawComputedStyle {
  color: string;
  backgroundColor: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  fontSize: string;
  fontWeight: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius: string;
}

function parsePx(value: string): number {
  return Number.parseFloat(value.replace("px", ""));
}

// Chromium normally resolves font-weight to a numeric string, but keyword
// forms ("normal"/"bold") show up depending on the element's font stack, so
// both forms need mapping to the same numeric representation for comparison.
const FONT_WEIGHT_KEYWORDS: Record<string, number> = { normal: 400, bold: 700 };

export function normalizeFontWeight(value: string): number | undefined {
  const numeric = Number.parseFloat(value);
  if (!Number.isNaN(numeric)) return numeric;
  return FONT_WEIGHT_KEYWORDS[value.toLowerCase()];
}

// A single computed corner property can itself be elliptical (e.g.
// "12px 8px" for horizontal/vertical radius), which parsePx's naive
// "strip the first px" would silently collapse to just the horizontal
// value — losing real shape information. Parse both axes explicitly.
function parseCornerRadius(value: string): { horizontal: number; vertical: number } {
  const [horizontalRaw, verticalRaw = horizontalRaw] = value.split(" ");
  return { horizontal: parsePx(horizontalRaw ?? ""), vertical: parsePx(verticalRaw ?? "") };
}

// The shared shape carries one scalar radius, so per-corner values only
// collapse to a value when every corner is circular (horizontal === vertical)
// and all four corners agree with each other — otherwise a single number
// would misrepresent an asymmetric or elliptical shape.
function normalizeCornerRadius(raw: RawComputedStyle): number | undefined {
  const corners = [
    raw.borderTopLeftRadius,
    raw.borderTopRightRadius,
    raw.borderBottomRightRadius,
    raw.borderBottomLeftRadius,
  ].map(parseCornerRadius);
  const isCircular = corners.every((corner) => corner.horizontal === corner.vertical);
  if (!isCircular) return undefined;
  const [first, ...rest] = corners;
  if (first === undefined || rest.some((corner) => corner.horizontal !== first.horizontal))
    return undefined;
  return first.horizontal;
}

function toHexChannel(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0");
}

// Alpha is always encoded (opaque = "ff"), never omitted, so a later
// equality-based diff against the Figma-side snapshot never has to
// special-case 6-vs-8-digit hex strings.
function normalizeColor(color: string): string | undefined {
  const match = color.match(/rgba?\(([^)]+)\)/);
  const channels = match?.[1];
  if (!channels) return undefined;
  const [r, g, b, a] = channels.split(",").map((part) => Number.parseFloat(part.trim()));
  if (r === undefined || g === undefined || b === undefined) return undefined;
  const alphaChannel = toHexChannel((a ?? 1) * 255);
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}${alphaChannel}`;
}

export async function captureElementStyle(page: Page, selector: string): Promise<StyleSnapshot> {
  const raw = await page.$eval(selector, (el): RawComputedStyle => {
    const style = getComputedStyle(el);
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      borderTopLeftRadius: style.borderTopLeftRadius,
      borderTopRightRadius: style.borderTopRightRadius,
      borderBottomRightRadius: style.borderBottomRightRadius,
      borderBottomLeftRadius: style.borderBottomLeftRadius,
    };
  });

  return {
    color: normalizeColor(raw.color),
    backgroundColor: normalizeColor(raw.backgroundColor),
    spacing: {
      top: parsePx(raw.paddingTop),
      right: parsePx(raw.paddingRight),
      bottom: parsePx(raw.paddingBottom),
      left: parsePx(raw.paddingLeft),
    },
    fontSize: parsePx(raw.fontSize),
    fontWeight: normalizeFontWeight(raw.fontWeight),
    cornerRadius: normalizeCornerRadius(raw),
  };
}
