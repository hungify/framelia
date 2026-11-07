<script setup lang="ts">
import RunDashboard from "../views/RunDashboard.vue";
</script>

<template>
  <!-- Shared parent of `/` and `/contracts/:id`: the dashboard (and its run fetch and live
       connection) mounts once; changing selection only changes the child route's params. -->
  <RunDashboard />
</template>
