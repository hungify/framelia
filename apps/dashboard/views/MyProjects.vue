<script setup lang="ts">
import { computed, ref } from "vue";

import notificationsIcon from "../assets/projects/notifications.svg";
import plusIcon from "../assets/projects/plus.svg";
import searchIcon from "../assets/projects/search.svg";
import Sidebar from "../components/Sidebar.vue";

type ProjectStatus = "On track" | "At risk" | "Complete";
type Project = {
  name: string;
  description: string;
  status: ProjectStatus;
  progress: number;
  members: string[];
  updated: string;
};

const searchQuery = ref("");
const mobileMenuOpen = ref(false);
const notice = ref("");

const projects: Project[] = [
  { name: "Northwind Rebrand", description: "Refreshed identity, marketing site, and design tokens for launch.", status: "On track", progress: 78, members: ["AL", "EB", "PR"], updated: "Updated 2 hours ago" },
  { name: "Mobile App v3", description: "Offline sync, new onboarding, and a redesigned project feed.", status: "At risk", progress: 46, members: ["MI", "SD"], updated: "Updated yesterday" },
  { name: "Billing Migration", description: "Move invoicing and plan management onto the new billing service.", status: "On track", progress: 92, members: ["TR", "AL", "MI", "PR"], updated: "Updated 3 days ago" },
  { name: "Design System 2.0", description: "Component audit, token rename, and documentation refresh.", status: "On track", progress: 34, members: ["SD", "EB"], updated: "Updated 4 days ago" },
  { name: "Onboarding Revamp", description: "Shorter signup flow with guided workspace setup checklists.", status: "Complete", progress: 100, members: ["PR", "TR"], updated: "Updated last week" },
  { name: "Support Portal", description: "Self-serve help centre with ticket history and status pages.", status: "On track", progress: 18, members: ["AL", "MI"], updated: "Updated last week" },
];

const filteredProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return projects;
  return projects.filter((project) => `${project.name} ${project.description} ${project.status}`.toLowerCase().includes(query));
});

function showNotice(message: string) {
  notice.value = message;
  window.setTimeout(() => {
    if (notice.value === message) notice.value = "";
  }, 2200);
}

</script>

<template>
  <div class="projects-page">
    <Sidebar v-model:mobile-menu-open="mobileMenuOpen" @notice="showNotice" />

    <section class="shell">
      <header class="topbar">
        <button class="mobile-menu-button" type="button" aria-label="Open navigation" @click="mobileMenuOpen = true"><span /><span /><span /></button>
        <label class="search-field">
          <img :src="searchIcon" alt="" />
          <input v-model="searchQuery" type="search" placeholder="Search customers, invoices…" aria-label="Search projects" />
        </label>
        <div class="topbar-actions">
          <button class="new-project-button" type="button" @click="showNotice('New project flow is coming soon.')"><img :src="plusIcon" alt="" />New Project</button>
          <button class="icon-button notification-button" type="button" aria-label="Notifications" @click="showNotice('No new notifications.')"><img :src="notificationsIcon" alt="" /><span class="notification-dot" /></button>
          <button class="avatar-button" type="button" aria-label="Open account menu" @click="showNotice('Account menu is coming soon.')"><span class="avatar">AL</span></button>
        </div>
      </header>

      <main class="main-content">
        <div class="page-heading">
          <h1>My Projects</h1>
          <p>Everything your team is working on right now.</p>
        </div>

        <section class="summary-grid" aria-label="Project summary">
          <article><p>Active projects</p><strong>6</strong></article>
          <article><p>Completed</p><strong>24</strong></article>
          <article><p>Team members</p><strong>12</strong></article>
        </section>

        <section class="projects-section" aria-labelledby="all-projects-title">
          <h2 id="all-projects-title">All projects</h2>
          <div class="project-grid">
            <article v-for="project in filteredProjects" :key="project.name" class="project-card">
              <div class="project-title-row">
                <h3>{{ project.name }}</h3>
                <span class="status-pill" :class="`status-pill--${project.status.toLowerCase().replace(' ', '-')}`">{{ project.status }}</span>
              </div>
              <p class="project-description">{{ project.description }}</p>
              <div class="progress-copy"><span>Progress</span><strong>{{ project.progress }}%</strong></div>
              <div class="progress-track"><span :style="{ width: `${project.progress}%` }" /></div>
              <div class="project-meta">
                <div class="member-list" aria-label="Project members">
                  <span v-for="member in project.members" :key="member" class="member-avatar">{{ member }}</span>
                </div>
                <span>{{ project.updated }}</span>
              </div>
            </article>
          </div>
          <p v-if="filteredProjects.length === 0" class="empty-state">No projects match “{{ searchQuery }}”.</p>
        </section>
      </main>
    </section>

    <Transition name="notice"><div v-if="notice" class="notice" role="status">{{ notice }}</div></Transition>
  </div>
</template>

<style scoped>
:global(html), :global(body), :global(#app) { min-height: 100%; margin: 0; background: #f9fafb; }
:global(body) { color: #0f1729; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.projects-page { min-height: 100vh; background: #f9fafb; color: #0f1729; font-size: 14px; }
.shell { min-height: 100vh; margin-left: 259px; }
.topbar { position: sticky; z-index: 10; top: 0; display: flex; height: 64px; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid #e5e7eb; background: #fff; }
.search-field { position: relative; display: flex; width: 384px; height: 36px; align-items: center; }
.search-field img { position: absolute; left: 12px; z-index: 1; }
.search-field input { width: 100%; height: 36px; padding: 0 13px 0 37px; border: 1px solid #e5e7eb; border-radius: 8px; outline: none; background: #f9fafb; color: #0f1729; font-size: 14px; }
.search-field input::placeholder { color: #9ca3af; }
.topbar-actions { display: flex; align-items: center; gap: 6px; }
.new-project-button { display: inline-flex; height: 36px; align-items: center; gap: 8px; padding: 0 12px; border-radius: 8px; background: #2463eb; box-shadow: 0 1px 1px rgb(0 0 0 / 5%); color: #fff; font-size: 14px; font-weight: 500; }
.icon-button, .avatar-button, .mobile-menu-button { position: relative; display: grid; width: 36px; height: 36px; place-items: center; border-radius: 8px; background: transparent; }
.icon-button img { width: 18px; height: 18px; }
.notification-dot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border: 2px solid #fff; border-radius: 999px; background: #2463eb; }
.mobile-menu-button { display: none; }
.main-content { width: min(857px, calc(100% - 64px)); margin: 0 auto; padding: 32px 0 64px; }
.page-heading { height: 56px; }
h1, h2, h3, p { margin: 0; }
h1 { color: #0f1729; font-size: 24px; font-weight: 600; letter-spacing: -.6px; line-height: 32px; }
.page-heading p { color: #6b7280; font-size: 14px; line-height: 20px; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; }
.summary-grid article { height: 106px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; }
.summary-grid p { color: #6b7280; line-height: 20px; }
.summary-grid strong { display: block; margin-top: 4px; color: #0f1729; font-size: 30px; font-weight: 600; letter-spacing: -.75px; line-height: 36px; }
.projects-section { margin-top: 24px; }
h2 { color: #0f1729; font-size: 16px; font-weight: 600; letter-spacing: -.4px; line-height: 24px; }
.project-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.project-card { height: 210px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 14px; background: #fff; }
.project-title-row { display: flex; height: 24px; align-items: flex-start; justify-content: space-between; gap: 10px; }
h3 { overflow: hidden; color: #0f1729; font-size: 16px; font-weight: 600; letter-spacing: -.4px; line-height: 24px; text-overflow: ellipsis; white-space: nowrap; }
.status-pill { flex: 0 0 auto; padding: 0 8px; border-radius: 999px; font-size: 12px; font-weight: 500; line-height: 20px; }
.status-pill--on-track { background: #ecfdf5; color: #047857; }
.status-pill--at-risk { background: #fffbeb; color: #b45309; }
.status-pill--complete { background: rgb(36 99 235 / 10%); color: #2463eb; }
.project-description { height: 40px; margin-top: 6px; color: #6b7280; font-size: 14px; line-height: 20px; }
.progress-copy { display: flex; justify-content: space-between; margin-top: 14px; color: #6b7280; font-size: 12px; line-height: 16px; }
.progress-copy strong { color: #0f1729; font-weight: 500; }
.progress-track { height: 6px; margin-top: 8px; overflow: hidden; border-radius: 999px; background: #f3f4f6; }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: #2463eb; }
.project-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 18px; color: #6b7280; font-size: 12px; line-height: 16px; }
.member-list { display: flex; padding-left: 0; }
.member-avatar { display: grid; width: 28px; height: 28px; place-items: center; margin-left: -6px; border: 2px solid #fff; border-radius: 999px; background: rgb(36 99 235 / 10%); color: #2463eb; font-size: 11px; font-weight: 600; }
.member-avatar:first-child { margin-left: 0; }
.empty-state { margin-top: 24px; color: #6b7280; }
.notice { position: fixed; z-index: 40; right: 24px; bottom: 24px; max-width: min(360px, calc(100vw - 48px)); padding: 12px 16px; border: 1px solid #dbe5ff; border-radius: 10px; background: #eff4ff; box-shadow: 0 12px 28px rgb(15 23 41 / 12%); color: #1d4ed8; font-size: 14px; }
.notice-enter-active, .notice-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.notice-enter-from, .notice-leave-to { opacity: 0; transform: translateY(8px); }
.mobile-scrim { display: none; }
@media (max-width: 900px) {
  .sidebar { height: 100vh; transform: translateX(-100%); transition: transform 180ms ease; }
  .sidebar--open { transform: translateX(0); }
  .mobile-scrim { position: fixed; z-index: 15; inset: 0; display: block; background: rgb(15 23 41 / 36%); }
  .shell { margin-left: 0; }
  .mobile-menu-button { display: grid; gap: 4px; padding: 9px; }
  .mobile-menu-button span { display: block; width: 18px; height: 2px; border-radius: 2px; background: #0f1729; }
  .topbar { gap: 12px; padding: 0 16px; }
  .search-field { flex: 1; width: auto; max-width: 384px; }
  .main-content { width: min(100% - 32px, 857px); padding-top: 24px; }
}
@media (max-width: 600px) {
  .notification-button { display: none; }
  .new-project-button { padding: 0 10px; font-size: 0; }
  .new-project-button img { margin: 0; }
  .summary-grid { grid-template-columns: 1fr; }
  .project-grid { grid-template-columns: 1fr; }
  .project-card { height: auto; min-height: 210px; }
}
</style>
