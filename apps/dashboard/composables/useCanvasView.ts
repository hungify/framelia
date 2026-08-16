import { reactive } from "vue";

export interface CanvasSize {
  width: number;
  height: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const FIT_PADDING_PX = 56;

/** Figma-style pan/zoom state for a single canvas viewport (translate + scale). */
export function useCanvasView() {
  const view = reactive({ scale: 1, tx: 0, ty: 0 });

  function clampScale(value: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  }

  function centerAt(container: CanvasSize, content: CanvasSize, scale: number): void {
    view.scale = clampScale(scale);
    view.tx = (container.width - content.width * view.scale) / 2;
    view.ty = (container.height - content.height * view.scale) / 2;
  }

  function fitToView(container: CanvasSize, content: CanvasSize, padding = FIT_PADDING_PX): void {
    if (!content.width || !content.height || !container.width || !container.height) return;
    const padX = Math.min(padding, container.width / 4);
    const padY = Math.min(padding, container.height / 4);
    const scale = Math.min(
      (container.width - padX * 2) / content.width,
      (container.height - padY * 2) / content.height,
    );
    centerAt(container, content, scale);
  }

  function zoomAt(factor: number, pivotX: number, pivotY: number): void {
    const nextScale = clampScale(view.scale * factor);
    if (nextScale === view.scale) return;
    view.tx = pivotX - ((pivotX - view.tx) / view.scale) * nextScale;
    view.ty = pivotY - ((pivotY - view.ty) / view.scale) * nextScale;
    view.scale = nextScale;
  }

  function pan(dx: number, dy: number): void {
    view.tx -= dx;
    view.ty -= dy;
  }

  return { view, MIN_ZOOM, MAX_ZOOM, clampScale, centerAt, fitToView, zoomAt, pan };
}
