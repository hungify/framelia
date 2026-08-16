import { onBeforeUnmount, onMounted, type Ref } from "vue";

import { isTypingTarget } from "../lib/dom";

interface ShortcutMode<Mode extends string> {
  value: Mode;
  code: string;
}

interface UseImageInspectorShortcutsOptions<Mode extends string> {
  modes: Array<ShortcutMode<Mode>>;
  mode: Ref<Mode>;
  fitToViewport: () => void;
  zoomTo100: () => void;
  stepZoom: (factor: number) => void;
  zoomStepFactor: number;
}

/** Wires global keyboard shortcuts (mode switch, zoom in/out, fit, 100%) for the image inspector. */
export function useImageInspectorShortcuts<Mode extends string>(
  options: UseImageInspectorShortcutsOptions<Mode>,
): void {
  function onKeydown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return;
    if (event.shiftKey && event.code === "Digit1") {
      options.fitToViewport();
      event.preventDefault();
      return;
    }
    if (event.shiftKey && event.code === "Digit0") {
      options.zoomTo100();
      event.preventDefault();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const shortcut = options.modes.find((item) => item.code === event.code);
    if (shortcut) {
      options.mode.value = shortcut.value;
      return;
    }
    if (event.code === "Equal" || event.code === "NumpadAdd") {
      options.stepZoom(options.zoomStepFactor);
      event.preventDefault();
    } else if (event.code === "Minus" || event.code === "NumpadSubtract") {
      options.stepZoom(1 / options.zoomStepFactor);
      event.preventDefault();
    }
  }

  onMounted(() => window.addEventListener("keydown", onKeydown));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
}
