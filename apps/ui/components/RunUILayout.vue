<script setup lang="ts">
import { computed } from "vue";

import type { UIArtifactMode } from "../lib/artifact-mode";
import { artifactModeMeta } from "../lib/artifact-mode";

const props = defineProps<{
  loading: boolean;
  error?: string;
  hasRun: boolean;
  title?: string;
  subtitle?: string;
  artifactMode: UIArtifactMode;
  railOpen: boolean;
  detailsOpen: boolean;
  showDetails: boolean;
}>();

defineEmits<{
  "update:railOpen": [value: boolean];
  "update:detailsOpen": [value: boolean];
}>();

const mode = computed(() => artifactModeMeta(props.artifactMode));

const workspaceStyle = computed(() => {
  const showDetails = props.detailsOpen && props.showDetails;
  return {
    "--rail-width": props.railOpen ? "264px" : "0px",
    "--rail-tablet-width": props.railOpen ? "232px" : "0px",
    "--rail-mobile-height": props.railOpen ? "260px" : "0px",
    "--details-width": showDetails ? "264px" : "0px",
    "--details-tablet-height": showDetails ? "150px" : "0px",
  };
});
</script>

<template>
  <div class="min-h-screen bg-bg">
    <header
      class="h-11 grid grid-cols-[1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center px-3.5 border-b border-line bg-panel"
    >
      <div class="flex items-center gap-3" aria-label="Framelia">
        <strong class="text-sm tracking-tight">Framelia</strong>
        <UFieldGroup size="xs">
          <UButton
            color="neutral"
            :variant="railOpen ? 'soft' : 'ghost'"
            size="xs"
            :aria-pressed="railOpen"
            @click="$emit('update:railOpen', !railOpen)"
          >
            Contracts
          </UButton>
          <UButton
            color="neutral"
            :variant="detailsOpen ? 'soft' : 'ghost'"
            size="xs"
            :aria-pressed="detailsOpen"
            @click="$emit('update:detailsOpen', !detailsOpen)"
          >
            Details
          </UButton>
        </UFieldGroup>
      </div>
      <div v-if="hasRun" class="hidden md:flex items-baseline gap-2">
        <span class="text-xs font-semibold">{{ title }}</span>
        <code class="text-muted text-xs">{{ subtitle }}</code>
      </div>
      <div class="justify-self-end flex items-center gap-1.75 text-muted text-xs">
        <span class="w-1.5 h-1.5 rounded-full" :class="mode.dotClass" />
        {{ mode.label }}
      </div>
    </header>

    <main v-if="loading" class="min-h-screen-header flex flex-col items-center justify-center">
      <p class="text-muted text-xs">Loading verification evidence</p>
      <UProgress class="w-45! mt-2" color="primary" size="xs" animation="carousel" />
    </main>

    <main
      v-else-if="error"
      class="min-h-screen-header flex flex-col items-center justify-center px-7.5 py-7.5 text-center"
    >
      <p class="m-0 text-muted text-xs">UI unavailable</p>
      <h1 class="max-w-155 my-3 text-2xl tracking-tighter">
        Verification artifact could not be loaded.
      </h1>
      <code class="max-w-170 p-2.5 text-red bg-danger-surface">{{ error }}</code>
      <p class="text-muted text-xs">
        Open this report through <code>framelia open</code> or serve static report directory over
        HTTP.
      </p>
    </main>

    <main
      v-else-if="hasRun"
      class="grid h-auto min-h-screen-header grid-cols-[minmax(0,1fr)] grid-rows-[var(--rail-mobile-height)_minmax(480px,65vh)_auto] overflow-visible bg-bg md:h-screen-header md:min-h-0 md:grid-cols-[var(--rail-tablet-width)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)_var(--details-tablet-height)] md:overflow-hidden lg:grid-cols-[var(--rail-width)_minmax(0,1fr)_var(--details-width)] lg:grid-rows-[minmax(0,1fr)]"
      :style="workspaceStyle"
    >
      <aside
        class="col-start-1 row-start-1 min-w-0 min-h-0 border-b border-line bg-panel overflow-hidden md:row-span-2 md:border-r md:border-b-0 lg:row-span-1"
        :aria-hidden="!railOpen"
        :inert="!railOpen"
      >
        <slot name="rail" />
      </aside>

      <section class="col-start-1 row-start-2 min-w-0 min-h-0 md:col-start-2 md:row-start-1">
        <slot />
      </section>

      <aside
        v-if="showDetails"
        class="col-start-1 row-start-3 min-w-0 min-h-45 border-t border-line bg-panel overflow-hidden md:min-h-0 md:col-start-2 md:row-start-2 lg:col-start-3 lg:row-start-1 lg:border-l lg:border-t-0"
        :aria-hidden="!detailsOpen"
        :inert="!detailsOpen"
      >
        <slot name="details" />
      </aside>
    </main>
  </div>
</template>
