<script setup lang="ts">
import type { UIVerdict } from "@framelia/contracts";

defineProps<{ status: UIVerdict }>();

const colors: Record<UIVerdict, "neutral" | "info" | "success" | "error" | "warning"> = {
  queued: "neutral",
  running: "info",
  passed: "success",
  "masked-pass": "warning",
  failed: "error",
  blocked: "warning",
};
</script>

<template>
  <UBadge
    class="w-fit! rounded-sm! font-semibold! text-xs! leading-none! font-mono! capitalize!"
    :data-status="status"
    :color="colors[status]"
    variant="subtle"
    size="sm"
  >
    {{ status }}
  </UBadge>
</template>
