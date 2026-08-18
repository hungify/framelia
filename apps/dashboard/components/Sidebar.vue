<script setup lang="ts">
import { useRouter } from "vue-router";

import chevronDownIcon from "../assets/sidebar/chevron-down.svg";
import homeIcon from "../assets/sidebar/home.svg";
import projectsIcon from "../assets/sidebar/projects.svg";
import settingsIcon from "../assets/sidebar/settings.svg";
import teamIcon from "../assets/sidebar/team.svg";

const props = withDefaults(
  defineProps<{
    mobileMenuOpen: boolean;
    activeLabel?: "Home" | "Projects" | "Team" | "Settings";
  }>(),
  { activeLabel: "Home" },
);

const emit = defineEmits<{
  "update:mobileMenuOpen": [value: boolean];
  notice: [message: string];
}>();

const router = useRouter();

const navigation = [
  { label: "Home", icon: homeIcon, route: "/" },
  { label: "Projects", icon: projectsIcon, route: "/projects", count: 6 },
  { label: "Team", icon: teamIcon },
  { label: "Settings", icon: settingsIcon },
] as const;

function selectNavigation(item: (typeof navigation)[number]) {
  emit("update:mobileMenuOpen", false);
  if (item.route) void router.push(item.route);
  else emit("notice", `${item.label} view is coming soon.`);
}
</script>

<template>
  <aside class="sidebar" :class="{ 'sidebar--open': props.mobileMenuOpen }">
    <div class="brand">
      <span class="brand-mark">F</span>
      <span class="brand-name">Framelia</span>
    </div>

    <nav class="primary-nav" aria-label="Primary navigation">
      <button
        v-for="item in navigation"
        :key="item.label"
        class="nav-item"
        :class="{ 'nav-item--active': item.label === props.activeLabel }"
        type="button"
        @click="selectNavigation(item)"
      >
        <img :src="item.icon" :alt="`${item.label} icon`" />
        <span>{{ item.label }}</span>
        <span v-if="item.count" class="nav-count">{{ item.count }}</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <button class="profile-card" type="button" @click="emit('notice', 'Account menu is coming soon.')">
        <span class="avatar avatar--large">AL</span>
        <span class="profile-copy">
          <strong>Ada Lovelace</strong>
          <small>ada@company.com</small>
        </span>
        <img :src="chevronDownIcon" alt="" />
      </button>
    </div>
  </aside>

  <div v-if="props.mobileMenuOpen" class="mobile-scrim" @click="emit('update:mobileMenuOpen', false)" />
</template>

<style scoped>
:global(button) {
  font: inherit;
}

.sidebar {
  position: fixed;
  z-index: 20;
  inset: 0 auto 0 0;
  display: flex;
  width: 259px;
  flex-direction: column;
  background: #fff;
  color: #0f1729;
}

.brand {
  display: flex;
  height: 64px;
  flex: 0 0 64px;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
}

.brand-mark {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 10px;
  background: #2463eb;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
}

.brand-name {
  color: #0f1729;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.35px;
}

.primary-nav {
  display: grid;
  flex: 1 1 auto;
  align-content: start;
  gap: 2px;
  padding: 8px 12px;
}

.nav-item,
.profile-card {
  border: 0;
  cursor: pointer;
}

.nav-item {
  display: flex;
  width: 235px;
  height: 36px;
  align-items: center;
  gap: 12px;
  padding: 0 10px;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  text-align: left;
}

.nav-item:nth-child(2) {
  height: 40px;
}

.nav-item img {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.nav-item span:not(.nav-count) {
  font-size: 14px;
  line-height: 20px;
}

.nav-item--active {
  background: #f3f4f6;
  color: #0f1729;
  font-weight: 500;
}

.nav-count {
  width: 24px;
  height: 24px;
  margin-left: auto;
  border-radius: 9999px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 11px;
  font-weight: 500;
  line-height: 24px;
  text-align: center;
}

.sidebar-footer {
  height: 79px;
  flex: 0 0 79px;
  padding: 12px;
  border-top: 1px solid #e5e7eb;
}

.profile-card {
  display: flex;
  width: 235px;
  height: 54px;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  text-align: left;
}

.profile-card > img {
  width: 16px;
  height: 16px;
  margin-left: auto;
}

.avatar {
  display: grid;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  place-items: center;
  border-radius: 9999px;
  background: rgb(36 99 235 / 10%);
  color: #2463eb;
  font-size: 12px;
  font-weight: 600;
}

.profile-copy {
  display: grid;
  min-width: 0;
  height: 36px;
}

.profile-copy strong,
.profile-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-copy strong {
  color: #0f1729;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}

.profile-copy small {
  color: #6b7280;
  font-size: 12px;
  line-height: 16px;
}

.mobile-scrim {
  position: fixed;
  z-index: 15;
  inset: 0;
  display: none;
  background: rgb(15 23 41 / 36%);
}

@media (max-width: 900px) {
  .sidebar {
    height: 100vh;
    transform: translateX(-100%);
    transition: transform 180ms ease;
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .mobile-scrim {
    display: block;
  }
}
</style>
