import type { Node, SolidPaint } from "@figma/rest-api-spec";
import type { ExpectStyle } from "@framelia/contracts";

export interface StyleSnapshot {
  /** Text/foreground paint. Only meaningful for TEXT nodes on the Figma side. */
  color?: string;
  /** Container/background paint -- a FRAME's (or other non-TEXT node's) fill. */
  backgroundColor?: string;
  spacing?: { top: number; right: number; bottom: number; left: number };
  fontSize?: number;
  fontWeight?: number;
  cornerRadius?: number;
}

export function extractFigmaStyle(node: Node): StyleSnapshot {
  const snapshot: StyleSnapshot = {};

  // A node's `fills` is a text paint on TEXT nodes but a background/container
  // paint everywhere else -- comparing both against the code side's CSS
  // `color` would conflate foreground and background paint. See PR #17 review.
  const fillColor = extractColor(node);
  if (fillColor !== undefined) {
    if (node.type === "TEXT") snapshot.color = fillColor;
    else snapshot.backgroundColor = fillColor;
  }

  const spacing = extractSpacing(node);
  if (spacing !== undefined) snapshot.spacing = spacing;

  if (node.type === "TEXT") {
    if (node.style.fontSize !== undefined) snapshot.fontSize = node.style.fontSize;
    if (node.style.fontWeight !== undefined) snapshot.fontWeight = node.style.fontWeight;
  }

  if ("cornerRadius" in node && node.cornerRadius !== undefined) {
    snapshot.cornerRadius = node.cornerRadius;
  }

  return snapshot;
}

/**
 * Bridges a contract's baked `ExpectStyle` (RGB 0-255 channels + separate 0-1 alpha,
 * `fontSizePx`) into the `StyleSnapshot` shape `compareStyles` consumes -- the two
 * schemas independently describe the same Figma-side style (see #6/#26), one for
 * contract authoring, one for runtime comparison. `lineHeightPx`/`letterSpacingPx`
 * have no `StyleSnapshot` counterpart and are dropped; `spacing`/`cornerRadius` are
 * never baked into `ExpectStyle` and stay undefined here too.
 */
export function expectStyleToSnapshot(expectStyle: ExpectStyle): StyleSnapshot {
  const snapshot: StyleSnapshot = {};

  if (expectStyle.fontWeight !== undefined) snapshot.fontWeight = expectStyle.fontWeight;
  if (expectStyle.fontSizePx !== undefined) snapshot.fontSize = expectStyle.fontSizePx;

  // colorProperty says which DOM property the color belongs against; without it
  // there's no way to tell color from backgroundColor, so the color is dropped
  // rather than guessed (deriveExpectStyle always sets both together).
  if (expectStyle.color && expectStyle.colorProperty) {
    snapshot[expectStyle.colorProperty] = expectStyleColorToHex(expectStyle.color);
  }

  return snapshot;
}

function expectStyleColorToHex(color: { r: number; g: number; b: number; a: number }): string {
  return `#${toHexChannel(color.r / 255)}${toHexChannel(color.g / 255)}${toHexChannel(color.b / 255)}${toHexChannel(color.a)}`;
}

function extractSpacing(node: Node): StyleSnapshot["spacing"] {
  if (!("paddingTop" in node)) return undefined;
  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node;
  // Only report spacing when all four sides are actually present -- a node
  // missing any one of them (non-auto-layout, or partial/malformed) must
  // leave spacing undefined rather than fabricate 0 for the rest.
  if (
    paddingTop === undefined ||
    paddingRight === undefined ||
    paddingBottom === undefined ||
    paddingLeft === undefined
  ) {
    return undefined;
  }
  return { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft };
}

function extractColor(node: Node): string | undefined {
  if (!("fills" in node) || !Array.isArray(node.fills)) return undefined;
  const solidFill = node.fills.find(
    (fill): fill is SolidPaint => fill.type === "SOLID" && fill.visible !== false,
  );
  if (!solidFill) return undefined;
  // solidFill.color is always the resolved literal, even when boundVariables.color
  // points at a Figma Variable -- resolving the variable itself needs the
  // Enterprise-only Variables API, out of scope for this feature, so it's
  // deliberately never read here.
  return toHexColor(solidFill.color, solidFill.opacity);
}

function toHexColor(
  color: { r: number; g: number; b: number },
  opacity: number | undefined,
): string {
  // Paint opacity is separate from color's own alpha component; undefined
  // means fully opaque. Always emit 8 digits (opaque = "ff") so a later
  // equality-based diff never has to special-case 6-vs-8-digit strings.
  const alpha = opacity ?? 1;
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}${toHexChannel(alpha)}`;
}

function toHexChannel(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
}
