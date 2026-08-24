import type { BoxShadow, CornerRadius, StyleSnapshot } from "@framelia/verify";
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
  lineHeight: string;
  letterSpacing: string;
  borderTopLeftRadius: string;
  borderTopRightRadius: string;
  borderBottomRightRadius: string;
  borderBottomLeftRadius: string;
  borderTopWidth: string;
  boxShadow: string;
  opacity: string;
  rowGap: string;
  columnGap: string;
  display: string;
  flexDirection: string;
  /** Untransformed layout border-box width a percentage-valued corner radius resolves
   *  against -- see extractCornerRadius. */
  borderBoxWidth: number;
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

// getComputedStyle() reports a percentage border-radius as-authored (e.g. "50%"), not
// resolved to px -- naively stripping "px" would silently treat the raw percentage
// number as pixels. Percentages resolve against the border-box width (CSSOM), so the
// caller passes that through from the browser context, where alone it's available. A
// computed corner value can also itself be elliptical (e.g. "12px 8px" for
// horizontal/vertical radius, space-separated); only the first (horizontal) component
// maps to Figma's per-corner model, so that's the only one parsed.
function parseCornerRadiusHorizontal(value: string, borderBoxWidth: number): number {
  const horizontalRaw = value.split(" ")[0] ?? "";
  if (horizontalRaw.endsWith("%")) {
    return (Number.parseFloat(horizontalRaw) / 100) * borderBoxWidth;
  }
  return parsePx(horizontalRaw);
}

// Reports every corner independently, matching Figma's own rectangleCornerRadii model
// (see figma-node-style.ts) — an asymmetric shape must never collapse to "undefined"
// just because the corners disagree.
function extractCornerRadius(raw: RawComputedStyle): CornerRadius {
  return {
    topLeft: parseCornerRadiusHorizontal(raw.borderTopLeftRadius, raw.borderBoxWidth),
    topRight: parseCornerRadiusHorizontal(raw.borderTopRightRadius, raw.borderBoxWidth),
    bottomRight: parseCornerRadiusHorizontal(raw.borderBottomRightRadius, raw.borderBoxWidth),
    bottomLeft: parseCornerRadiusHorizontal(raw.borderBottomLeftRadius, raw.borderBoxWidth),
  };
}

// "normal" letter-spacing means no adjustment — equivalent to a real 0 rather than an
// absent value, so it doesn't fabricate a false "field only present on one side" skip
// in compareStyles.
function parseLetterSpacing(value: string): number {
  return value === "normal" ? 0 : parsePx(value);
}

// "normal" line-height has no fixed px value without font metrics unlike letter-spacing's
// 0 — fabricating a number here would risk a false mismatch against a real Figma value,
// so it's left undefined and simply skipped by compareStyles like any other absent field.
function parseLineHeight(value: string): number | undefined {
  return value === "normal" ? undefined : parsePx(value);
}

// Figma's itemSpacing measures only the auto-layout frame's primary-axis spacing, which
// row-gap and column-gap don't uniformly map to: for `flex-direction: row` the primary axis
// is horizontal (column-gap sits between side-by-side items), for `column` it's vertical
// (row-gap). When both are equal there's no ambiguity either way. When they differ and the
// element isn't itself a flex container (e.g. CSS grid, or a gap set on some other display),
// there's no well-defined single-axis equivalent to Figma's itemSpacing, so it's left
// unmatched rather than guessed. An unset gap computes to "normal", equivalent to a real 0
// rather than an absent value (same reasoning as parseLetterSpacing's "normal").
function parseGap(raw: RawComputedStyle): number | undefined {
  const rowGap = raw.rowGap === "normal" ? 0 : parsePx(raw.rowGap);
  const columnGap = raw.columnGap === "normal" ? 0 : parsePx(raw.columnGap);
  if (rowGap === columnGap) return rowGap;
  if (raw.display !== "flex" && raw.display !== "inline-flex") return undefined;
  return raw.flexDirection.startsWith("row") ? columnGap : rowGap;
}

// Matches the leading `<color> <offsetX>px <offsetY>px <blurRadius>px <spreadRadius>px` of
// Chromium's serialized box-shadow -- e.g. "rgba(0, 0, 0, 0.25) 0px 4px 8px 0px". Only the
// first shadow in a stacked list is captured: the pattern stops consuming after the fourth
// length, so a second comma-separated shadow never gets pulled into the match.
const BOX_SHADOW_PATTERN =
  /(rgba?\([^)]+\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/;

function parseBoxShadow(value: string): BoxShadow | undefined {
  if (value === "none") return undefined;
  const match = BOX_SHADOW_PATTERN.exec(value);
  const [, color, offsetX, offsetY, blurRadius, spreadRadius] = match ?? [];
  if (
    match === null ||
    color === undefined ||
    offsetX === undefined ||
    offsetY === undefined ||
    blurRadius === undefined ||
    spreadRadius === undefined
  ) {
    return undefined;
  }
  const normalizedColor = normalizeColor(color);
  if (normalizedColor === undefined) return undefined;
  // The "inset" keyword can appear before the color or after the lengths depending on
  // authoring order, and Chromium's serialization isn't relied on to normalize it to one
  // position -- so the whole first shadow (everything up to the next top-level comma, which
  // never falls inside the matched color function) is searched instead of a fixed offset.
  const nextCommaIndex = value.indexOf(",", match.index + match[0].length);
  const firstShadowText = nextCommaIndex === -1 ? value : value.slice(0, nextCommaIndex);
  const inset = /\binset\b/.test(firstShadowText);
  return {
    offsetX: Number.parseFloat(offsetX),
    offsetY: Number.parseFloat(offsetY),
    blurRadius: Number.parseFloat(blurRadius),
    spreadRadius: Number.parseFloat(spreadRadius),
    color: normalizedColor,
    inset,
  };
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
    const contentWidth = Number.parseFloat(style.width);
    const borderBoxWidth =
      style.boxSizing === "border-box"
        ? contentWidth
        : contentWidth +
          Number.parseFloat(style.paddingLeft) +
          Number.parseFloat(style.paddingRight) +
          Number.parseFloat(style.borderLeftWidth) +
          Number.parseFloat(style.borderRightWidth);
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      borderTopLeftRadius: style.borderTopLeftRadius,
      borderTopRightRadius: style.borderTopRightRadius,
      borderBottomRightRadius: style.borderBottomRightRadius,
      borderBottomLeftRadius: style.borderBottomLeftRadius,
      borderTopWidth: style.borderTopWidth,
      boxShadow: style.boxShadow,
      opacity: style.opacity,
      rowGap: style.rowGap,
      columnGap: style.columnGap,
      display: style.display,
      flexDirection: style.flexDirection,
      // Derived from getComputedStyle, not getBoundingClientRect().width/offsetWidth --
      // the former reflects any CSS transform (e.g. scaleX) and the latter rounds to an
      // integer, while a percentage border-radius resolves against the untransformed,
      // fractional layout border-box width (CSS Backgrounds and Borders spec).
      borderBoxWidth,
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
    lineHeightPx: parseLineHeight(raw.lineHeight),
    letterSpacingPx: parseLetterSpacing(raw.letterSpacing),
    cornerRadius: extractCornerRadius(raw),
    borderWidth: parsePx(raw.borderTopWidth),
    boxShadow: parseBoxShadow(raw.boxShadow),
    opacity: Number.parseFloat(raw.opacity),
    gap: parseGap(raw),
  };
}
