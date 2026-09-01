<script setup lang="ts">
import type { DashboardContractResult } from "@framelia/contracts";
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from "vue";

import { useCanvasView, type CanvasSize } from "../composables/useCanvasView";
import { useEvidenceSizing, type EvidenceKind } from "../composables/useEvidenceSizing";
import { useImageInspectorShortcuts } from "../composables/useImageInspectorShortcuts";
import { usePanZoomInteractions } from "../composables/usePanZoomInteractions";
import ImageReveal from "./ImageReveal.vue";

const props = defineProps<{
  contract: DashboardContractResult;
  artifactUrl: (path: string | undefined) => string;
}>();

type Mode = "baseline" | "actual" | "overlay" | "diff" | "split";
const mode = ref<Mode>("overlay");
const reveal = ref(50);
const opacity = ref(55);
const differenceBlend = ref(true);

const modes: Array<{ value: Mode; label: string; code: string }> = [
  { value: "baseline", label: "Baseline", code: "Digit1" },
  { value: "actual", label: "Actual", code: "Digit2" },
  { value: "overlay", label: "Scrub", code: "Digit3" },
  { value: "diff", label: "Diff", code: "Digit4" },
  { value: "split", label: "Split", code: "Digit5" },
];

const baselineUrl = computed(() => props.artifactUrl(props.contract.baseline?.path));
const actualUrl = computed(() => props.artifactUrl(props.contract.actual?.path));
const diffUrl = computed(() => props.artifactUrl(props.contract.diff?.path));
const ready = computed(() => Boolean(props.contract.baseline && props.contract.actual));

const { contentSize, evidenceSize, imageStyle, measureContent, recordNaturalSize, resetSizes } =
  useEvidenceSizing(toRef(props, "contract"));

const sizeMismatch = computed(() => {
  const baseline = evidenceSize("baseline");
  const actual = evidenceSize("actual");
  return Boolean(
    baseline.width &&
    baseline.height &&
    actual.width &&
    actual.height &&
    (baseline.width !== actual.width || baseline.height !== actual.height),
  );
});

const viewportEl = ref<HTMLElement | null>(null);
const splitPaneEl = ref<HTMLElement | null>(null);
const autoFit = ref(true);
const fittedScale = ref(1);
const { view, MIN_ZOOM, MAX_ZOOM, fitToView, centerAt, zoomAt, pan } = useCanvasView();
const canPan = computed(() => view.scale > fittedScale.value + 0.001);

function containerSize(): CanvasSize {
  const el = viewportEl.value;
  if (!el) return { width: 0, height: 0 };
  if (mode.value === "split" && splitPaneEl.value) {
    return { width: splitPaneEl.value.clientWidth, height: splitPaneEl.value.clientHeight };
  }
  return { width: el.clientWidth, height: el.clientHeight };
}

function fitToViewport(): void {
  if (!contentSize.width || !contentSize.height) return;
  const container = containerSize();
  if (!container.width || !container.height) return;
  fitToView(container, contentSize, mode.value === "split" ? 20 : 40);
  fittedScale.value = view.scale;
  autoFit.value = true;
}

function zoomTo100(): void {
  if (!contentSize.width || !contentSize.height) return;
  centerAt(containerSize(), contentSize, 1);
  autoFit.value = false;
}

function onImageLoad(event: Event, kind: EvidenceKind): void {
  const img = event.target as HTMLImageElement;
  recordNaturalSize(kind, img.naturalWidth, img.naturalHeight);
  if (measureContent() && autoFit.value) fitToViewport();
}

watch(
  () => [
    props.contract.id,
    props.contract.baseline?.path,
    props.contract.baseline?.width,
    props.contract.baseline?.height,
    props.contract.actual?.path,
    props.contract.actual?.width,
    props.contract.actual?.height,
    props.contract.diff?.path,
  ],
  () => {
    resetSizes();
    autoFit.value = true;
    reveal.value = 50;
    opacity.value = 55;
    differenceBlend.value = true;
    void nextTick(() => {
      if (measureContent()) fitToViewport();
    });
  },
  { immediate: true },
);

watch(mode, () => {
  void nextTick(fitToViewport);
});

let resizeObserver: ResizeObserver | null = null;
watch(viewportEl, (el) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el) return;
  if (autoFit.value) fitToViewport();
  resizeObserver = new ResizeObserver(() => {
    if (autoFit.value) fitToViewport();
  });
  resizeObserver.observe(el);
});

const contentStyle = computed(() => ({
  transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
  transformOrigin: "0 0",
  width: contentSize.width ? `${contentSize.width}px` : undefined,
  height: contentSize.height ? `${contentSize.height}px` : undefined,
}));

const zoomPercent = computed(() => Math.round(view.scale * 100));
const zoomStepFactor = 1.2;

const panZoom = usePanZoomInteractions(view, { zoomAt, pan }, canPan, () => {
  autoFit.value = false;
});
const { dragState, startPan, movePan, endPan } = panZoom;

function stepZoom(factor: number): void {
  panZoom.stepZoom(factor, containerSize());
}

function onWheel(event: WheelEvent): void {
  if (!ready.value) return;
  const rect = viewportEl.value?.getBoundingClientRect();
  if (!rect) return;
  let pivotX = event.clientX - rect.left;
  let pivotY = event.clientY - rect.top;
  if (mode.value === "split" && splitPaneEl.value) {
    pivotX %= splitPaneEl.value.clientWidth;
    pivotY %= splitPaneEl.value.clientHeight;
  }
  panZoom.onWheel(event, { x: pivotX, y: pivotY });
}

useImageInspectorShortcuts({
  modes,
  mode,
  fitToViewport,
  zoomTo100,
  stepZoom,
  zoomStepFactor,
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <section
    class="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)] bg-bg overflow-hidden"
    aria-label="Visual comparison inspector"
  >
    <div
      v-if="ready"
      ref="viewportEl"
      class="relative col-span-full row-start-2 min-h-0 overflow-hidden bg-[#101214]"
      :class="
        canPan
          ? dragState
            ? 'touch-none cursor-grabbing'
            : 'touch-none cursor-grab'
          : 'touch-pan-y cursor-default'
      "
      @wheel="onWheel"
      @pointerdown="startPan"
      @pointermove="movePan"
      @pointerup="endPan"
      @pointercancel="endPan"
    >
      <div
        v-if="mode === 'split'"
        class="absolute inset-0 grid grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-none"
      >
        <div
          ref="splitPaneEl"
          class="relative min-w-0 min-h-0 overflow-hidden border-b border-line md:border-r md:border-b-0"
        >
          <span
            class="absolute top-2.5 left-2.5 z-1 px-2 py-0.75 rounded-sm bg-scrim text-muted font-semibold text-xs leading-none font-mono pointer-events-none"
            >Baseline</span
          >
          <div
            class="absolute top-0 left-0 bg-evidence-surface shadow-evidence-card"
            :style="contentStyle"
          >
            <img
              class="block max-w-none select-none [-webkit-user-drag:none]"
              :style="imageStyle('baseline')"
              :src="baselineUrl"
              alt="Baseline capture"
              draggable="false"
              @load="onImageLoad($event, 'baseline')"
            />
          </div>
        </div>
        <div class="relative min-w-0 min-h-0 overflow-hidden">
          <span
            class="absolute top-2.5 left-2.5 z-1 px-2 py-0.75 rounded-sm bg-scrim text-muted font-semibold text-xs leading-none font-mono pointer-events-none"
            >Actual</span
          >
          <div
            class="absolute top-0 left-0 bg-evidence-surface shadow-evidence-card"
            :style="contentStyle"
          >
            <img
              class="block max-w-none select-none [-webkit-user-drag:none]"
              :style="imageStyle('actual')"
              :src="actualUrl"
              alt="Actual capture"
              draggable="false"
              @load="onImageLoad($event, 'actual')"
            />
          </div>
        </div>
      </div>

      <div
        v-if="mode !== 'split'"
        class="absolute top-0 left-0 bg-evidence-surface shadow-evidence-card"
        :style="contentStyle"
      >
        <ImageReveal
          v-if="mode === 'overlay'"
          v-model="reveal"
          :before-src="baselineUrl"
          :after-src="actualUrl"
          before-alt="Baseline capture"
          after-alt="Actual capture"
          :opacity="opacity"
          :difference-blend="differenceBlend"
          :canvas-width="contentSize.width"
          :canvas-height="contentSize.height"
          :before-width="evidenceSize('baseline').width"
          :before-height="evidenceSize('baseline').height"
          :after-width="evidenceSize('actual').width"
          :after-height="evidenceSize('actual').height"
          :zoom="view.scale"
          @before-load="onImageLoad($event, 'baseline')"
          @after-load="onImageLoad($event, 'actual')"
        />
        <img
          v-else-if="mode === 'baseline'"
          class="block max-w-none select-none [-webkit-user-drag:none]"
          :style="imageStyle('baseline')"
          :src="baselineUrl"
          alt="Baseline capture"
          draggable="false"
          @load="onImageLoad($event, 'baseline')"
        />
        <img
          v-else-if="mode === 'actual'"
          class="block max-w-none select-none [-webkit-user-drag:none]"
          :style="imageStyle('actual')"
          :src="actualUrl"
          alt="Actual capture"
          draggable="false"
          @load="onImageLoad($event, 'actual')"
        />
        <img
          v-else-if="mode === 'diff' && diffUrl"
          class="block max-w-none select-none [-webkit-user-drag:none]"
          :style="imageStyle('diff')"
          :src="diffUrl"
          alt="Visual difference heatmap"
          draggable="false"
          @load="onImageLoad($event, 'diff')"
        />
      </div>

      <div
        v-if="mode === 'diff' && !diffUrl"
        class="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6 text-muted text-center bg-transparent"
      >
        <strong class="text-text text-base">No diff image</strong>
        <p class="max-w-105 m-0 text-xs">Comparison produced no residual heatmap.</p>
      </div>
    </div>

    <div
      v-if="!ready"
      class="col-span-full row-span-full flex flex-col items-center justify-center gap-1.5 px-6 text-muted text-center bg-bg"
    >
      <strong class="text-text text-base">Evidence unavailable</strong>
      <p class="max-w-105 m-0 text-xs">
        {{ contract.blockers[0]?.message ?? "Capture has not completed." }}
      </p>
    </div>

    <div
      v-if="ready"
      class="col-span-full row-start-1 min-w-0 flex items-center justify-start gap-0.5 px-2 py-1.5 border-b border-line bg-panel overflow-x-auto scroll-fade-x md:col-start-1"
    >
      <UFieldGroup class="flex items-center gap-0.5" role="tablist" aria-label="Comparison mode">
        <UButton
          v-for="item in modes"
          :key="item.value"
          role="tab"
          :aria-selected="mode === item.value"
          color="neutral"
          variant="ghost"
          size="sm"
          class="min-h-7.5 px-2.75! py-1.25! border-0 rounded-toolbar-control! text-xs cursor-pointer"
          :class="
            mode === item.value
              ? 'text-[#11151a]! bg-accent! hover:bg-accent!'
              : 'bg-transparent! text-muted! hover:text-text! hover:bg-toolbar-hover!'
          "
          @click="mode = item.value"
        >
          {{ item.label }}
        </UButton>
      </UFieldGroup>
      <template v-if="mode === 'overlay'">
        <span class="w-px h-5 mx-1 bg-line" aria-hidden="true" />
        <label class="flex items-center gap-1.5 pl-0.5 pr-1.5 text-muted text-xs">
          <span>Opacity</span>
          <USlider
            v-model="opacity"
            class="w-22.5"
            :min="0"
            :max="100"
            color="primary"
            size="xs"
            aria-label="Opacity"
          />
          <output class="min-w-8 text-right text-[#b9bdc2] text-xs">{{ opacity }}%</output>
        </label>
        <label class="flex items-center gap-1 pl-0.5 pr-1.5 text-muted text-xs"
          ><UCheckbox v-model="differenceBlend" size="xs" aria-label="Difference blend" /><span
            >Difference</span
          ></label
        >
      </template>
      <span v-if="sizeMismatch" class="ml-1 text-amber text-xs"
        >Size mismatch — overlay remains 1:1, never stretched</span
      >
    </div>

    <UFieldGroup
      v-if="ready"
      class="hidden md:flex col-start-2 row-start-1 items-center justify-end gap-0.5 px-2 py-1.5 border-b border-line bg-panel"
    >
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-h-7 px-2.25! py-1! border-0 rounded-toolbar-control! bg-transparent! text-muted! font-medium text-xs leading-none font-mono cursor-pointer enabled:hover:text-text! enabled:hover:bg-toolbar-hover! disabled:opacity-35 disabled:cursor-default"
        aria-label="Zoom out"
        :disabled="zoomPercent <= MIN_ZOOM * 100"
        @click="stepZoom(1 / zoomStepFactor)"
      >
        −
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-h-7 min-w-11.5 px-2.25! py-1! border-0 rounded-toolbar-control! bg-transparent! text-muted! font-medium text-xs leading-none font-mono cursor-pointer enabled:hover:text-text! enabled:hover:bg-toolbar-hover!"
        title="Fit to view"
        @click="fitToViewport"
      >
        {{ zoomPercent }}%
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-h-7 px-2.25! py-1! border-0 rounded-toolbar-control! bg-transparent! text-muted! font-medium text-xs leading-none font-mono cursor-pointer enabled:hover:text-text! enabled:hover:bg-toolbar-hover! disabled:opacity-35 disabled:cursor-default"
        aria-label="Zoom in"
        :disabled="zoomPercent >= MAX_ZOOM * 100"
        @click="stepZoom(zoomStepFactor)"
      >
        +
      </UButton>
      <span class="w-px h-4.5 mx-0.5 bg-line" aria-hidden="true" />
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-h-7 px-2.25! py-1! border-0 rounded-toolbar-control! bg-transparent! text-muted! font-medium text-xs leading-none font-mono cursor-pointer hover:text-text! hover:bg-toolbar-hover!"
        @click="zoomTo100"
        >100%</UButton
      >
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        class="min-h-7 px-2.25! py-1! border-0 rounded-toolbar-control! bg-transparent! text-muted! font-medium text-xs leading-none font-mono cursor-pointer hover:text-text! hover:bg-toolbar-hover!"
        @click="fitToViewport"
        >Fit</UButton
      >
    </UFieldGroup>
  </section>
</template>
