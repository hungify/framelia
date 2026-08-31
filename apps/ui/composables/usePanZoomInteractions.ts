import { ref, type ComputedRef } from "vue";

import type { CanvasSize } from "./useCanvasView";

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originTx: number;
  originTy: number;
}

interface ViewState {
  tx: number;
  ty: number;
  scale: number;
}

interface PanZoomActions {
  zoomAt: (factor: number, pivotX: number, pivotY: number) => void;
  pan: (dx: number, dy: number) => void;
}

/** Pointer-drag panning + wheel zoom/pan for a canvas viewport built on `useCanvasView`. */
export function usePanZoomInteractions(
  view: ViewState,
  actions: PanZoomActions,
  canPan: ComputedRef<boolean>,
  onManualInteraction: () => void,
) {
  const dragState = ref<DragState | null>(null);

  function startPan(event: PointerEvent): void {
    if (!canPan.value) return;
    if (event.button !== 0 && event.button !== 1) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragState.value = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originTx: view.tx,
      originTy: view.ty,
    };
  }

  function movePan(event: PointerEvent): void {
    const drag = dragState.value;
    if (!drag || drag.pointerId !== event.pointerId) return;
    view.tx = drag.originTx + (event.clientX - drag.startX);
    view.ty = drag.originTy + (event.clientY - drag.startY);
    onManualInteraction();
  }

  function endPan(event: PointerEvent): void {
    if (dragState.value?.pointerId === event.pointerId) dragState.value = null;
  }

  function stepZoom(factor: number, container: CanvasSize): void {
    actions.zoomAt(factor, container.width / 2, container.height / 2);
    onManualInteraction();
  }

  function onWheel(event: WheelEvent, pivot: { x: number; y: number }): void {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      actions.zoomAt(Math.exp(-event.deltaY * 0.01), pivot.x, pivot.y);
    } else if (canPan.value) {
      event.preventDefault();
      actions.pan(event.deltaX, event.deltaY);
    } else {
      return;
    }
    onManualInteraction();
  }

  return { dragState, startPan, movePan, endPan, onWheel, stepZoom };
}
