import { describe, expect, it } from "vitest";

import { useCanvasView } from "../composables/useCanvasView";

describe("useCanvasView", () => {
  it("clamps scale to the configured zoom range", () => {
    const { view, clampScale, MIN_ZOOM, MAX_ZOOM } = useCanvasView();
    expect(clampScale(0)).toBe(MIN_ZOOM);
    expect(clampScale(100)).toBe(MAX_ZOOM);
    expect(clampScale(1)).toBe(1);
    expect(view.scale).toBe(1);
  });

  it("centers content in the container at a given scale", () => {
    const { view, centerAt } = useCanvasView();
    centerAt({ width: 200, height: 100 }, { width: 50, height: 50 }, 2);
    expect(view.scale).toBe(2);
    expect(view.tx).toBe((200 - 50 * 2) / 2);
    expect(view.ty).toBe((100 - 50 * 2) / 2);
  });

  it("fits content to the container, respecting padding", () => {
    const { view, fitToView } = useCanvasView();
    fitToView({ width: 400, height: 400 }, { width: 100, height: 200 }, 0);
    expect(view.scale).toBeCloseTo(2);
  });

  it("does nothing when container or content has zero size", () => {
    const { view, fitToView } = useCanvasView();
    fitToView({ width: 0, height: 400 }, { width: 100, height: 200 });
    expect(view.scale).toBe(1);
    expect(view.tx).toBe(0);
  });

  it("zooms around a pivot point, keeping the pivot fixed in content space", () => {
    const { view, zoomAt } = useCanvasView();
    zoomAt(2, 50, 50);
    expect(view.scale).toBe(2);
    expect(view.tx).toBe(50 - (50 - 0) * 2);
    expect(view.ty).toBe(50 - (50 - 0) * 2);
  });

  it("is a no-op when the zoom factor would leave scale unchanged after clamping", () => {
    const { view, zoomAt } = useCanvasView();
    zoomAt(1000, 50, 50);
    const { tx, ty, scale } = view;
    zoomAt(1000, 50, 50);
    expect(view).toMatchObject({ tx, ty, scale });
  });

  it("pans by subtracting the delta from the current translation", () => {
    const { view, pan } = useCanvasView();
    pan(10, -5);
    expect(view.tx).toBe(-10);
    expect(view.ty).toBe(5);
  });
});
