import type { DiffCluster } from "./pixel.ts";

/** A style-check selector's captured DOM bounds, in the same pixel coordinate space as
 *  the diff PNG (see @framelia/playwright's captureElementBounds). */
export interface SelectorBounds {
  selector: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiffRegionAttribution {
  bbox: DiffCluster["bbox"];
  pixels: number;
  /** Selectors whose bounds overlap this cluster; empty when no style-check
   *  selector bounds overlap it -- left unattributed rather than guessed. */
  selectors: string[];
}

function overlaps(bbox: DiffCluster["bbox"], bounds: SelectorBounds): boolean {
  return (
    bbox.x0 < bounds.x + bounds.width &&
    bbox.x1 > bounds.x &&
    bbox.y0 < bounds.y + bounds.height &&
    bbox.y1 > bounds.y
  );
}

/**
 * Cross-references pixel-diff clusters against style-check selector bounds so a diff
 * region can be traced back to the check-point(s) it likely came from (e.g. "this
 * cluster = mismatch on .header") instead of staying an unexplained pixel blob. Pure
 * rectangle-overlap test -- no guessing at the nearest selector when nothing overlaps.
 */
export function attributeDiffRegions(
  clusters: DiffCluster[],
  selectors: SelectorBounds[],
): DiffRegionAttribution[] {
  return clusters.map((cluster) => ({
    bbox: cluster.bbox,
    pixels: cluster.pixels,
    selectors: selectors.filter((bounds) => overlaps(cluster.bbox, bounds)).map((b) => b.selector),
  }));
}
