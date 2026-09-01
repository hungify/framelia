<script setup lang="ts">
import { computed, ref } from "vue";

const props = withDefaults(
  defineProps<{
    beforeSrc: string;
    afterSrc: string;
    beforeAlt?: string;
    afterAlt?: string;
    opacity?: number;
    differenceBlend?: boolean;
    canvasWidth: number;
    canvasHeight: number;
    beforeWidth: number;
    beforeHeight: number;
    afterWidth: number;
    afterHeight: number;
    zoom?: number;
  }>(),
  {
    beforeAlt: "Before image",
    afterAlt: "After image",
    opacity: 100,
    differenceBlend: false,
    zoom: 1,
  },
);

const emit = defineEmits<{ beforeLoad: [Event]; afterLoad: [Event] }>();

const reveal = defineModel<number>({ default: 50 });
const root = ref<HTMLElement | null>(null);
const activePointer = ref<number | null>(null);

const canvasStyle = computed(() => ({
  width: props.canvasWidth ? `${props.canvasWidth}px` : undefined,
  height: props.canvasHeight ? `${props.canvasHeight}px` : undefined,
}));
const beforeStyle = computed(() => ({
  width: props.beforeWidth ? `${props.beforeWidth}px` : undefined,
  height: props.beforeHeight ? `${props.beforeHeight}px` : undefined,
}));
const blendMode = computed<"difference" | "normal">(() =>
  props.differenceBlend ? "difference" : "normal",
);
const handleStyle = computed(() => ({
  transform: `translate(-50%, -50%) scale(${1 / (props.zoom || 1)})`,
}));
const afterStyle = computed(() => ({
  width: props.afterWidth ? `${props.afterWidth}px` : undefined,
  height: props.afterHeight ? `${props.afterHeight}px` : undefined,
  clipPath: `inset(0 ${Math.max(0, props.afterWidth - (props.canvasWidth * reveal.value) / 100)}px 0 0)`,
  opacity: props.opacity / 100,
  mixBlendMode: blendMode.value,
}));

function updateReveal(clientX: number) {
  const bounds = root.value?.getBoundingClientRect();
  if (!bounds?.width) return;
  reveal.value = Math.round(
    Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100)),
  );
}

function startDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  activePointer.value = event.pointerId;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  updateReveal(event.clientX);
}

function drag(event: PointerEvent) {
  if (activePointer.value === event.pointerId) updateReveal(event.clientX);
}

function stopDrag(event: PointerEvent) {
  if (activePointer.value === event.pointerId) activePointer.value = null;
}

function onKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? 10 : 1;
  if (event.key === "ArrowLeft") reveal.value = Math.max(0, reveal.value - step);
  else if (event.key === "ArrowRight") reveal.value = Math.min(100, reveal.value + step);
  else if (event.key === "Home") reveal.value = 0;
  else if (event.key === "End") reveal.value = 100;
  else return;
  event.preventDefault();
}
</script>

<template>
  <div
    ref="root"
    class="relative flex-none overflow-hidden bg-evidence-surface shadow-evidence-card"
    :style="canvasStyle"
  >
    <img
      class="absolute inset-0 block max-w-none select-none [-webkit-user-drag:none]"
      :src="beforeSrc"
      :alt="beforeAlt"
      :style="beforeStyle"
      draggable="false"
      @load="emit('beforeLoad', $event)"
    />
    <img
      class="block max-w-none select-none [-webkit-user-drag:none] absolute inset-0"
      :src="afterSrc"
      :alt="afterAlt"
      :style="afterStyle"
      draggable="false"
      @load="emit('afterLoad', $event)"
    />
    <div
      class="absolute inset-y-0 w-9 -ml-4.5 cursor-ew-resize touch-none before:content-[''] before:absolute before:inset-y-0 before:left-1/2 before:bg-accent before:-translate-x-1/2 hover:before:w-0.5 focus-visible:before:w-0.5 focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
      :class="activePointer !== null ? 'before:w-0.5' : 'before:w-px'"
      :style="{ left: `${reveal}%` }"
      role="slider"
      tabindex="0"
      aria-label="Reveal after image"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="reveal"
      @pointerdown.prevent.stop="startDrag"
      @pointermove.prevent.stop="drag"
      @pointerup.stop="stopDrag"
      @pointercancel.stop="stopDrag"
      @keydown="onKeydown"
    >
      <span
        aria-hidden="true"
        class="absolute top-1/2 left-1/2 w-4.5 h-7.5 border-2 border-accent rounded-[6px] bg-[#20252b] before:content-[''] before:absolute before:top-1/2 before:left-1.5 before:w-0 before:h-0 before:border-t-[6px] before:border-b-[6px] before:border-t-transparent before:border-b-transparent before:border-r-[6px] before:border-r-accent before:-translate-y-1/2 after:content-[''] after:absolute after:top-1/2 after:right-1.5 after:w-0 after:h-0 after:border-t-[6px] after:border-b-[6px] after:border-t-transparent after:border-b-transparent after:border-l-[6px] after:border-l-accent after:-translate-y-1/2"
        :style="handleStyle"
      />
    </div>
  </div>
</template>
