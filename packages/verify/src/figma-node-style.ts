import type {
  DropShadowEffect,
  Effect,
  InnerShadowEffect,
  LocalVariable,
  LocalVariableCollection,
  Node,
  RGBA,
  SolidPaint,
} from "@figma/rest-api-spec";
import type { ExpectStyle } from "@framelia/contracts";

export interface CornerRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

/**
 * The first visible shadow effect, structurally comparable to a parsed DOM `box-shadow`
 * (see capture-style.ts's parseBoxShadow). Only one shadow is captured on either side even
 * when a node/element stacks several -- there's no reliable ordering guarantee between a
 * Figma effects list and a CSS box-shadow list to pair up the rest.
 */
export interface BoxShadow {
  offsetX: number;
  offsetY: number;
  blurRadius: number;
  spreadRadius: number;
  color: string;
  /** true for a Figma INNER_SHADOW / CSS `inset` shadow, false for a drop/outer shadow --
   *  compared as an exact field so an inner and outer shadow with identical geometry and
   *  color still flag as a mismatch. */
  inset: boolean;
}

/**
 * The subset of `GET /v1/files/:file_key/variables/local`'s response needed to resolve a bound
 * color variable to its current value. Fetching this is Enterprise-plan-gated on Figma's side, so
 * callers should only fetch it when a node actually has a bound color (see `boundColorVariableId`)
 * and must treat a fetch failure as non-fatal -- `extractFigmaStyle` already falls back to the
 * paint's literal color when this is omitted or doesn't contain the bound variable.
 */
export interface FigmaVariablesData {
  variables: Record<string, LocalVariable>;
  variableCollections: Record<string, LocalVariableCollection>;
}

export interface StyleSnapshot {
  /** Text/foreground paint. Only meaningful for TEXT nodes on the Figma side. */
  color?: string;
  /** Container/background paint -- a FRAME's (or other non-TEXT node's) fill. */
  backgroundColor?: string;
  spacing?: { top: number; right: number; bottom: number; left: number };
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  letterSpacingPx?: number;
  cornerRadius?: CornerRadius;
  /** Uniform stroke weight -- only the frame-wide value, mirroring extractSpacing's
   *  all-or-nothing approach; per-side individualStrokeWeights aren't compared. */
  borderWidth?: number;
  boxShadow?: BoxShadow;
  opacity?: number;
  /** Auto-layout's itemSpacing (primary-axis gap between children). */
  gap?: number;
}

export function extractFigmaStyle(node: Node, variables?: FigmaVariablesData): StyleSnapshot {
  const snapshot: StyleSnapshot = {};

  // A node's `fills` is a text paint on TEXT nodes but a background/container
  // paint everywhere else -- comparing both against the code side's CSS
  // `color` would conflate foreground and background paint. See PR #17 review.
  const fillColor = extractColor(node, variables);
  if (fillColor !== undefined) {
    if (node.type === "TEXT") snapshot.color = fillColor;
    else snapshot.backgroundColor = fillColor;
  }

  const spacing = extractSpacing(node);
  if (spacing !== undefined) snapshot.spacing = spacing;

  if (node.type === "TEXT") {
    if (node.style.fontSize !== undefined) snapshot.fontSize = node.style.fontSize;
    if (node.style.fontWeight !== undefined) snapshot.fontWeight = node.style.fontWeight;
    if (node.style.lineHeightPx !== undefined) snapshot.lineHeightPx = node.style.lineHeightPx;
    if (node.style.letterSpacing !== undefined) snapshot.letterSpacingPx = node.style.letterSpacing;
  }

  const cornerRadius = extractCornerRadius(node);
  if (cornerRadius !== undefined) snapshot.cornerRadius = cornerRadius;

  if ("strokeWeight" in node && typeof node.strokeWeight === "number") {
    snapshot.borderWidth = node.strokeWeight;
  }

  if ("itemSpacing" in node && typeof node.itemSpacing === "number") {
    snapshot.gap = node.itemSpacing;
  }

  if ("opacity" in node && typeof node.opacity === "number") {
    snapshot.opacity = node.opacity;
  }

  const boxShadow = extractBoxShadow(node);
  if (boxShadow !== undefined) snapshot.boxShadow = boxShadow;

  return snapshot;
}

/**
 * The first visible drop/inner shadow among a node's effects, converted to the same shape
 * capture-style.ts's parseBoxShadow parses a DOM `box-shadow` into. Blur/texture/noise
 * effects have no CSS box-shadow equivalent, so only DROP_SHADOW/INNER_SHADOW are looked at.
 */
function extractBoxShadow(node: Node): BoxShadow | undefined {
  if (!("effects" in node) || !Array.isArray(node.effects)) return undefined;
  const shadow = node.effects.find(isVisibleShadowEffect);
  if (!shadow) return undefined;
  return {
    offsetX: shadow.offset.x,
    offsetY: shadow.offset.y,
    blurRadius: shadow.radius,
    spreadRadius: shadow.spread ?? 0,
    color: toHexColor(shadow.color, shadow.color.a),
    inset: shadow.type === "INNER_SHADOW",
  };
}

function isVisibleShadowEffect(effect: Effect): effect is DropShadowEffect | InnerShadowEffect {
  return (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") && effect.visible;
}

/**
 * `rectangleCornerRadii` (per-corner, top-left/top-right/bottom-right/bottom-left) takes
 * priority when present -- a uniform `cornerRadius` is only a fallback, and expanding it to
 * all four corners keeps the DOM-side comparison in style-compare.ts uniform regardless of
 * which form the node used.
 */
function extractCornerRadius(node: Node): CornerRadius | undefined {
  if ("rectangleCornerRadii" in node && Array.isArray(node.rectangleCornerRadii)) {
    const [topLeft, topRight, bottomRight, bottomLeft] = node.rectangleCornerRadii;
    if (
      topLeft !== undefined &&
      topRight !== undefined &&
      bottomRight !== undefined &&
      bottomLeft !== undefined
    ) {
      return { topLeft, topRight, bottomRight, bottomLeft };
    }
  }
  if ("cornerRadius" in node && node.cornerRadius !== undefined) {
    const radius = node.cornerRadius;
    return { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius };
  }
  return undefined;
}

/**
 * Bridges a contract's baked `ExpectStyle` (RGB 0-255 channels + separate 0-1 alpha,
 * `fontSizePx`) into the `StyleSnapshot` shape `compareStyles` consumes -- the two
 * schemas independently describe the same Figma-side style (see #6/#26), one for
 * contract authoring, one for runtime comparison. `spacing`/`cornerRadius` are never
 * baked into `ExpectStyle` and stay undefined here too.
 */
export function expectStyleToSnapshot(expectStyle: ExpectStyle): StyleSnapshot {
  const snapshot: StyleSnapshot = {};

  if (expectStyle.fontWeight !== undefined) snapshot.fontWeight = expectStyle.fontWeight;
  if (expectStyle.fontSizePx !== undefined) snapshot.fontSize = expectStyle.fontSizePx;
  if (expectStyle.lineHeightPx !== undefined) snapshot.lineHeightPx = expectStyle.lineHeightPx;
  if (expectStyle.letterSpacingPx !== undefined)
    snapshot.letterSpacingPx = expectStyle.letterSpacingPx;

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

/**
 * The variable id bound to a node's fill color, if any -- lets a caller decide whether the
 * extra (Enterprise-gated) variables/local API call is worth making before fetching it, instead
 * of paying for it on every node regardless of whether it uses bound variables.
 */
export function boundColorVariableId(node: Node): string | undefined {
  return findSolidFill(node)?.boundVariables?.color?.id;
}

function findSolidFill(node: Node): SolidPaint | undefined {
  if (!("fills" in node) || !Array.isArray(node.fills)) return undefined;
  return node.fills.find(
    (fill): fill is SolidPaint => fill.type === "SOLID" && fill.visible !== false,
  );
}

function extractColor(node: Node, variables?: FigmaVariablesData): string | undefined {
  const solidFill = findSolidFill(node);
  if (!solidFill) return undefined;
  const resolved = resolveBoundColor(node, solidFill, variables);
  if (resolved !== undefined) return resolved;
  // Either the fill isn't bound to a variable, or it is but `variables` wasn't supplied
  // (no bound color present, fetch failed, or the token can't reach the Enterprise-only
  // Variables API) -- the literal is always the correct/only value in the former case, and
  // the best available fallback in the latter.
  return toHexColor(solidFill.color, solidFill.opacity);
}

/**
 * Resolves `solidFill.boundVariables.color` to the variable's current value for the mode this
 * node explicitly uses, falling back to the collection's default mode when the node doesn't set
 * one explicitly. Ancestor-level mode overrides aren't visible from a single fetched node, so an
 * inherited (non-default, non-explicit) mode isn't resolved exactly -- a documented limitation,
 * not a silent wrong answer, since the caller falls back to the literal paint color instead.
 * Returns undefined (not a guess) for anything else unresolvable: no bound variable, no
 * `variables` payload, a deleted variable, a non-COLOR variable, or an unfollowed alias chain.
 */
function resolveBoundColor(
  node: Node,
  solidFill: SolidPaint,
  variables: FigmaVariablesData | undefined,
): string | undefined {
  const alias = solidFill.boundVariables?.color;
  if (!alias || !variables) return undefined;

  const variable = variables.variables[alias.id];
  if (!variable || variable.resolvedType !== "COLOR") return undefined;

  const collection = variables.variableCollections[variable.variableCollectionId];
  if (!collection) return undefined;

  const modeId = node.explicitVariableModes?.[collection.id] ?? collection.defaultModeId;
  const value = variable.valuesByMode[modeId];
  if (!isRgba(value)) return undefined;

  // Unlike a literal fill (where transparency lives on the paint's `opacity`), a bound
  // variable can carry its own alpha in `value.a` (e.g. a "White 50%" token) -- both must
  // combine, or a translucent token's fill on a fully-opaque paint would round-trip as opaque.
  const combinedOpacity = (value.a ?? 1) * (solidFill.opacity ?? 1);
  return toHexColor(value, combinedOpacity);
}

function isRgba(value: unknown): value is RGBA {
  if (typeof value !== "object" || value === null) return false;
  const { r, g, b, a } = value as Partial<RGBA>;
  // r/g/b must be finite numbers -- a malformed or partial value (missing channel, NaN,
  // Infinity) must fall back to the literal paint color instead of producing a garbage hex
  // string (e.g. toHexChannel(undefined) rounds to "NaN" and gets embedded verbatim).
  if (!isFiniteNumber(r) || !isFiniteNumber(g) || !isFiniteNumber(b)) return false;
  if (a !== undefined && !isFiniteNumber(a)) return false;
  return true;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
