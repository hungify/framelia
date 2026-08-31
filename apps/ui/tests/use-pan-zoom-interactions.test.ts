import { describe, expect, it, vi } from "vitest";
import { computed, reactive } from "vue";

import { usePanZoomInteractions } from "../composables/usePanZoomInteractions";

function pointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    pointerId: 1,
    button: 0,
    clientX: 0,
    clientY: 0,
    currentTarget: { setPointerCapture: vi.fn<(pointerId: number) => void>() },
    ...overrides,
  } as unknown as PointerEvent;
}

function wheelEvent(overrides: Partial<WheelEvent> = {}): WheelEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    deltaX: 0,
    deltaY: 0,
    preventDefault: vi.fn<() => void>(),
    ...overrides,
  } as unknown as WheelEvent;
}

function setup(canPanValue = true) {
  const view = reactive({ tx: 0, ty: 0, scale: 1 });
  const actions = {
    zoomAt: vi.fn<(factor: number, pivotX: number, pivotY: number) => void>(),
    pan: vi.fn<(dx: number, dy: number) => void>(),
  };
  const canPan = computed(() => canPanValue);
  const onManualInteraction = vi.fn<() => void>();
  const interactions = usePanZoomInteractions(view, actions, canPan, onManualInteraction);
  return { view, actions, onManualInteraction, ...interactions };
}

describe("usePanZoomInteractions", () => {
  it("drags the view by the pointer delta from where the drag started", () => {
    const { view, startPan, movePan, onManualInteraction } = setup();
    startPan(pointerEvent({ clientX: 100, clientY: 50 }));
    movePan(pointerEvent({ clientX: 130, clientY: 40 }));
    expect(view.tx).toBe(30);
    expect(view.ty).toBe(-10);
    expect(onManualInteraction).toHaveBeenCalled();
  });

  it("ignores movePan for a pointer that never started a drag", () => {
    const { view, movePan } = setup();
    movePan(pointerEvent({ pointerId: 2, clientX: 999, clientY: 999 }));
    expect(view).toMatchObject({ tx: 0, ty: 0 });
  });

  it("ignores a second pointer's move while the first pointer is dragging", () => {
    const { view, startPan, movePan } = setup();
    startPan(pointerEvent({ pointerId: 1, clientX: 0, clientY: 0 }));
    movePan(pointerEvent({ pointerId: 2, clientX: 500, clientY: 500 }));
    expect(view).toMatchObject({ tx: 0, ty: 0 });
  });

  it("stops the drag on endPan for the matching pointer only", () => {
    const { dragState, startPan, endPan } = setup();
    startPan(pointerEvent({ pointerId: 1 }));
    endPan(pointerEvent({ pointerId: 2 }));
    expect(dragState.value).not.toBeNull();
    endPan(pointerEvent({ pointerId: 1 }));
    expect(dragState.value).toBeNull();
  });

  it("does not start a drag when panning is disallowed", () => {
    const { dragState, startPan } = setup(false);
    startPan(pointerEvent());
    expect(dragState.value).toBeNull();
  });

  it("does not start a drag on a non-primary, non-middle pointer button", () => {
    const { dragState, startPan } = setup();
    startPan(pointerEvent({ button: 2 }));
    expect(dragState.value).toBeNull();
  });

  it("zooms on ctrl/meta wheel and pans otherwise when allowed", () => {
    const { actions, onManualInteraction, onWheel } = setup();
    onWheel(wheelEvent({ ctrlKey: true, deltaY: -10 }), { x: 5, y: 5 });
    expect(actions.zoomAt).toHaveBeenCalledWith(Math.exp(0.1), 5, 5);

    onWheel(wheelEvent({ deltaX: 3, deltaY: 4 }), { x: 0, y: 0 });
    expect(actions.pan).toHaveBeenCalledWith(3, 4);
    expect(onManualInteraction).toHaveBeenCalledTimes(2);
  });

  it("ignores a plain wheel event when panning is disallowed", () => {
    const { actions, onManualInteraction, onWheel } = setup(false);
    onWheel(wheelEvent({ deltaX: 3, deltaY: 4 }), { x: 0, y: 0 });
    expect(actions.pan).not.toHaveBeenCalled();
    expect(onManualInteraction).not.toHaveBeenCalled();
  });

  it("zooms toward the container center on stepZoom", () => {
    const { actions, onManualInteraction, stepZoom } = setup();
    stepZoom(1.5, { width: 200, height: 100 });
    expect(actions.zoomAt).toHaveBeenCalledWith(1.5, 100, 50);
    expect(onManualInteraction).toHaveBeenCalled();
  });
});
