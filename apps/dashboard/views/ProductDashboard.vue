<script setup lang="ts">
import { computed, ref } from "vue";

import exportIcon from "../assets/dashboard/export.svg";
import notificationsIcon from "../assets/dashboard/notifications.svg";
import plusIcon from "../assets/dashboard/plus.svg";
import searchIcon from "../assets/dashboard/search.svg";
import trendDownIcon from "../assets/dashboard/revenue-chart.svg";
import trendUpIcon from "../assets/dashboard/trend-up.svg";
import Sidebar from "../components/Sidebar.vue";

type TransactionStatus = "Paid" | "Pending" | "Failed";

const stats = [
  { label: "Revenue", value: "$248,900", change: "+12.4%", detail: "vs. $221,400 last month", wide: true },
  { label: "Active users", value: "18,204", change: "+8.1%", detail: "1,362 new this month" },
  { label: "Growth rate", value: "5.7%", change: "+1.2 pts", detail: "Compounding weekly" },
  { label: "Churn", value: "1.9%", change: "-0.4 pts", detail: "41 accounts cancelled", negative: true },
];

const transactions: Array<{
  customer: string;
  email: string;
  invoice: string;
  plan: string;
  status: TransactionStatus;
  date: string;
  amount: string;
}> = [
  { customer: "Nora Whitfield", email: "nora@northwind.io", invoice: "INV-2451", plan: "Scale", status: "Paid", date: "Sep 14, 2026", amount: "$1,240.00" },
  { customer: "Elias Bergman", email: "elias@lumenlabs.co", invoice: "INV-2450", plan: "Growth", status: "Paid", date: "Sep 13, 2026", amount: "$480.00" },
  { customer: "Priya Raman", email: "priya@corvidhq.com", invoice: "INV-2449", plan: "Growth", status: "Pending", date: "Sep 13, 2026", amount: "$480.00" },
  { customer: "Marcus Ilo", email: "marcus@arclight.dev", invoice: "INV-2448", plan: "Starter", status: "Failed", date: "Sep 12, 2026", amount: "$120.00" },
  { customer: "Sofia Duarte", email: "sofia@meridian.app", invoice: "INV-2447", plan: "Scale", status: "Paid", date: "Sep 11, 2026", amount: "$1,240.00" },
  { customer: "Tobias Renner", email: "tobias@fernwork.io", invoice: "INV-2446", plan: "Starter", status: "Paid", date: "Sep 10, 2026", amount: "$120.00" },
];

const activeRange = ref("12M");
const searchQuery = ref("");
const mobileMenuOpen = ref(false);
const notice = ref("");

const filteredTransactions = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return transactions;
  return transactions.filter((transaction) =>
    [transaction.customer, transaction.email, transaction.invoice, transaction.plan, transaction.status]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
});

function showNotice(message: string) {
  notice.value = message;
  window.setTimeout(() => {
    if (notice.value === message) notice.value = "";
  }, 2200);
}

</script>

<template>
  <div class="framelia-dashboard">
    <Sidebar v-model:mobile-menu-open="mobileMenuOpen" @notice="showNotice" />

    <section class="dashboard-shell">
      <header class="topbar">
        <button class="mobile-menu-button" type="button" aria-label="Open navigation" @click="mobileMenuOpen = true">
          <span />
          <span />
          <span />
        </button>
        <label class="search-field">
          <img :src="searchIcon" alt="" />
          <input v-model="searchQuery" type="search" placeholder="Search customers, invoices…" aria-label="Search customers and invoices" />
        </label>
        <div class="topbar-actions">
          <button class="icon-button notification-button" type="button" aria-label="Notifications" @click="showNotice('No new notifications.')">
            <img :src="notificationsIcon" alt="" />
            <span class="notification-dot" />
          </button>
          <button class="avatar-button" type="button" aria-label="Open account menu" @click="showNotice('Account menu is coming soon.')">
            <span class="avatar">AL</span>
          </button>
        </div>
      </header>

      <main class="main-content">
        <div class="page-heading">
          <div>
            <h1>Welcome back, Ada</h1>
            <p>Here's how Framelia is performing in September 2026.</p>
          </div>
          <div class="heading-actions">
            <button class="button button--secondary" type="button" @click="showNotice('Export prepared from mock data.')">
              <img :src="exportIcon" alt="" />
              Export
            </button>
            <button class="button button--primary" type="button" @click="showNotice('New project flow is coming soon.')">
              <img :src="plusIcon" alt="" />
              New project
            </button>
          </div>
        </div>

        <section class="stats-grid" aria-label="Performance overview">
          <article v-for="stat in stats" :key="stat.label" class="stat-card" :class="{ 'stat-card--wide': stat.wide }">
            <p class="stat-label">{{ stat.label }}</p>
            <p class="stat-value">{{ stat.value }}</p>
            <div class="stat-foot">
              <span class="trend-pill" :class="{ 'trend-pill--negative': stat.negative }">
                <img :src="stat.negative ? trendDownIcon : trendUpIcon" alt="" />
                {{ stat.change }}
              </span>
              <span>{{ stat.detail }}</span>
            </div>
          </article>
        </section>

        <section class="chart-card" aria-labelledby="revenue-title">
          <div class="card-heading">
            <div>
              <h2 id="revenue-title">Revenue</h2>
              <p>Monthly recurring revenue vs. target</p>
            </div>
            <div class="range-switcher" role="group" aria-label="Revenue range">
              <button v-for="range in ['3M', '6M', '12M']" :key="range" type="button" :class="{ 'range-button--active': activeRange === range }" @click="activeRange = range">
                {{ range }}
              </button>
            </div>
          </div>
          <div class="chart-placeholder" aria-label="Revenue chart placeholder" />
        </section>

        <section class="transactions-card" aria-labelledby="transactions-title">
          <div class="transactions-heading">
            <div>
              <h2 id="transactions-title">Recent transactions</h2>
              <p>Last 6 invoices across all workspaces</p>
            </div>
            <button class="link-button" type="button" @click="showNotice('Showing all mock transactions.')">View all</button>
          </div>

          <div class="transaction-table-wrap">
            <table class="transaction-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Invoice</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th class="amount-column">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="transaction in filteredTransactions" :key="transaction.invoice">
                  <td>
                    <strong>{{ transaction.customer }}</strong>
                    <small>{{ transaction.email }}</small>
                  </td>
                  <td>{{ transaction.invoice }}</td>
                  <td>{{ transaction.plan }}</td>
                  <td><span class="status-pill" :class="`status-pill--${transaction.status.toLowerCase()}`">{{ transaction.status }}</span></td>
                  <td>{{ transaction.date }}</td>
                  <td class="amount-column">{{ transaction.amount }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="transaction-list">
            <article v-for="transaction in filteredTransactions" :key="transaction.invoice" class="transaction-list-item">
              <div>
                <strong>{{ transaction.customer }}</strong>
                <p>{{ transaction.invoice }} · {{ transaction.plan }} · {{ transaction.date }}</p>
              </div>
              <div class="transaction-list-meta">
                <strong>{{ transaction.amount }}</strong>
                <span class="status-pill" :class="`status-pill--${transaction.status.toLowerCase()}`">{{ transaction.status }}</span>
              </div>
            </article>
          </div>
        </section>
      </main>
    </section>

    <Transition name="notice">
      <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    </Transition>
  </div>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  min-height: 100%;
  background: #f9fafb;
}

:global(body) {
  color: #0f1729;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

:global(button),
:global(input) {
  font: inherit;
}

.framelia-dashboard {
  min-height: 100vh;
  background: #f9fafb;
  color: #0f1729;
  font-size: 14px;
}

.sidebar {
  position: fixed;
  z-index: 20;
  inset: 0 auto 0 0;
  display: flex;
  width: 260px;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #e5e7eb;
}

.brand {
  display: flex;
  height: 64px;
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
  gap: 2px;
  padding: 8px 12px;
}

.nav-item,
.profile-card,
.icon-button,
.avatar-button,
.mobile-menu-button,
.button,
.link-button,
.range-switcher button {
  border: 0;
  cursor: pointer;
}

.nav-item {
  display: flex;
  height: 36px;
  align-items: center;
  gap: 12px;
  padding: 0 10px;
  border-radius: 8px;
  background: transparent;
  color: #6b7280;
  text-align: left;
}

.nav-item img,
.button img,
.search-field img {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
}

.nav-item span:not(.nav-count) {
  font-size: 14px;
}

.nav-item--active {
  background: #f3f4f6;
  color: #0f1729;
  font-weight: 500;
}

.nav-count {
  margin-left: auto;
  min-width: 24px;
  padding: 2px 7px;
  border-radius: 999px;
  background: #f3f4f6;
  color: #6b7280;
  font-size: 11px;
  line-height: 20px;
  text-align: center;
}

.profile-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: calc(100% - 24px);
  height: 54px;
  margin: auto 12px 12px;
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
  place-items: center;
  border-radius: 999px;
  background: rgb(36 99 235 / 10%);
  color: #2463eb;
  font-size: 12px;
  font-weight: 600;
}

.avatar--large {
  flex: 0 0 32px;
}

.profile-copy {
  display: grid;
  gap: 0;
  min-width: 0;
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

.dashboard-shell {
  min-height: 100vh;
  margin-left: 259px;
}

.topbar {
  position: sticky;
  z-index: 10;
  top: 0;
  display: flex;
  height: 64px;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

.search-field {
  position: relative;
  display: flex;
  width: 384px;
  height: 36px;
  align-items: center;
}

.search-field img {
  position: absolute;
  left: 12px;
  z-index: 1;
}

.search-field input {
  width: 100%;
  height: 36px;
  padding: 0 13px 0 37px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  outline: none;
  background: #f9fafb;
  color: #0f1729;
  font-size: 14px;
}

.search-field input::placeholder {
  color: #9ca3af;
}

.search-field input:focus {
  border-color: #2463eb;
  box-shadow: 0 0 0 3px rgb(36 99 235 / 12%);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.icon-button,
.avatar-button,
.mobile-menu-button {
  position: relative;
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 8px;
  background: transparent;
}

.icon-button img {
  width: 18px;
  height: 18px;
}

.notification-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 8px;
  height: 8px;
  border: 2px solid #fff;
  border-radius: 999px;
  background: #2463eb;
}

.mobile-menu-button {
  display: none;
}

.main-content {
  width: min(872px, calc(100% - 64px));
  margin: 0 auto;
  padding: 32px 0 45px;
}

.page-heading,
.card-heading,
.transactions-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.page-heading {
  min-height: 56px;
  margin-bottom: 24px;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  color: #0f1729;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.6px;
  line-height: 32px;
}

h2 {
  color: #0f1729;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.page-heading p,
.card-heading p,
.transactions-heading p {
  color: #6b7280;
  font-size: 14px;
  line-height: 20px;
}

.heading-actions {
  display: flex;
  gap: 8px;
}

.button {
  display: inline-flex;
  height: 36px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}

.button--secondary {
  border: 1px solid #e5e7eb;
  background: #fff;
  color: #0f1729;
}

.button--primary {
  background: #2463eb;
  box-shadow: 0 1px 1px rgb(0 0 0 / 5%);
  color: #fff;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  min-height: 134px;
  padding: 20px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #fff;
}

.stat-card--wide {
  grid-column: 1 / -1;
  min-height: 138px;
}

.stat-label,
.stat-foot {
  color: #6b7280;
}

.stat-label {
  line-height: 20px;
}

.stat-value {
  margin: 4px 0 8px;
  color: #0f1729;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.6px;
  line-height: 32px;
}

.stat-card--wide .stat-value {
  margin-top: 4px;
  font-size: 30px;
  letter-spacing: -0.75px;
  line-height: 36px;
}

.stat-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.trend-pill,
.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
}

.trend-pill {
  gap: 4px;
  padding: 0 8px;
  background: #ecfdf5;
  color: #047857;
}

.trend-pill img {
  width: 12px;
  height: 12px;
}

.trend-pill--negative {
  background: #ecfdf5;
  color: #047857;
}

.chart-card,
.transactions-card {
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #fff;
}

.chart-card {
  height: 374px;
  margin-bottom: 24px;
  padding: 24px;
}

.chart-card .card-heading {
  height: 44px;
}

.range-switcher {
  display: flex;
  height: 30px;
  align-items: center;
  padding: 3px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.range-switcher button {
  height: 24px;
  padding: 0 10px;
  border-radius: 5px;
  background: transparent;
  color: #6b7280;
  font-size: 12px;
}

.range-switcher button + button {
  margin-left: 1px;
}

.range-button--active {
  background: #f3f4f6 !important;
  color: #0f1729 !important;
  font-weight: 600;
}

.chart-placeholder {
  height: 256px;
  margin-top: 24px;
}

.transactions-card {
  overflow: hidden;
}

.transactions-heading {
  min-height: 77px;
  align-items: center;
  padding: 16px 24px;
}

.link-button {
  background: transparent;
  color: #2463eb;
  font-size: 14px;
}

.transaction-table-wrap {
  overflow-x: auto;
}

.transaction-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  table-layout: fixed;
}

.transaction-table th,
.transaction-table td {
  padding: 0 24px;
  text-align: left;
  vertical-align: middle;
}

.transaction-table th {
  height: 40px;
  background: #f9fafb;
  color: #6b7280;
  font-size: 12px;
  font-weight: 500;
}

.transaction-table td {
  height: 65px;
  border-top: 1px solid #e5e7eb;
  color: #6b7280;
  font-size: 14px;
}

.transaction-table td:first-child {
  color: #0f1729;
}

.transaction-table td strong,
.transaction-table td small {
  display: block;
}

.transaction-table td strong {
  color: #0f1729;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}

.transaction-table td small {
  color: #6b7280;
  font-size: 12px;
  line-height: 16px;
}

.transaction-table th:nth-child(1),
.transaction-table td:nth-child(1) { width: 23%; }
.transaction-table th:nth-child(2),
.transaction-table td:nth-child(2) { width: 15%; }
.transaction-table th:nth-child(3),
.transaction-table td:nth-child(3) { width: 13%; }
.transaction-table th:nth-child(4),
.transaction-table td:nth-child(4) { width: 15%; }
.transaction-table th:nth-child(5),
.transaction-table td:nth-child(5) { width: 18%; }

.amount-column {
  text-align: right !important;
}

.amount-column,
.transaction-table td.amount-column {
  color: #0f1729;
  font-weight: 500;
}

.status-pill {
  padding: 0 8px;
}

.status-pill--paid {
  background: #ecfdf5;
  color: #047857;
}

.status-pill--pending {
  background: #fffbeb;
  color: #b45309;
}

.status-pill--failed {
  background: rgb(220 40 40 / 10%);
  color: #dc2828;
}

.transaction-list {
  display: none;
}

.notice {
  position: fixed;
  z-index: 40;
  right: 24px;
  bottom: 24px;
  max-width: min(360px, calc(100vw - 48px));
  padding: 12px 16px;
  border: 1px solid #dbe5ff;
  border-radius: 10px;
  background: #eff4ff;
  box-shadow: 0 12px 28px rgb(15 23 41 / 12%);
  color: #1d4ed8;
  font-size: 14px;
}

.notice-enter-active,
.notice-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.notice-enter-from,
.notice-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

.mobile-scrim {
  display: none;
}

@media (max-width: 900px) {
  .sidebar {
    transform: translateX(-100%);
    transition: transform 180ms ease;
  }

  .sidebar--open {
    transform: translateX(0);
  }

  .mobile-scrim {
    position: fixed;
    z-index: 15;
    inset: 0;
    display: block;
    background: rgb(15 23 41 / 36%);
  }

  .dashboard-shell {
    margin-left: 0;
  }

  .mobile-menu-button {
    display: grid;
    gap: 4px;
    padding: 9px;
  }

  .mobile-menu-button span {
    display: block;
    width: 18px;
    height: 2px;
    border-radius: 2px;
    background: #0f1729;
  }

  .topbar {
    gap: 12px;
    padding: 0 16px;
  }

  .search-field {
    flex: 1;
    width: auto;
    max-width: 384px;
  }

  .main-content {
    width: min(100% - 32px, 872px);
    padding-top: 24px;
  }
}

@media (max-width: 600px) {
  .topbar {
    height: 64px;
  }

  .topbar-actions {
    gap: 0;
  }

  .notification-button {
    display: none;
  }

  .page-heading {
    display: block;
    margin-bottom: 24px;
  }

  h1 {
    font-size: 22px;
  }

  .page-heading p {
    margin-top: 4px;
    font-size: 13px;
  }

  .heading-actions {
    margin-top: 16px;
  }

  .heading-actions .button {
    flex: 1;
  }

  .stats-grid {
    grid-template-columns: 1fr;
  }

  .stat-card--wide {
    grid-column: auto;
  }

  .stat-foot {
    white-space: normal;
  }

  .chart-card {
    height: 408px;
    padding: 20px;
  }

  .chart-card .card-heading {
    display: block;
    height: 86px;
  }

  .range-switcher {
    width: max-content;
    margin-top: 12px;
  }

  .chart-placeholder {
    height: 256px;
    margin-top: 24px;
  }

  .transactions-heading {
    display: block;
    padding: 16px 20px;
  }

  .transactions-heading .link-button {
    margin-top: 16px;
    padding: 0;
  }

  .transaction-table-wrap {
    display: none;
  }

  .transaction-list {
    display: block;
  }

  .transaction-list-item {
    display: flex;
    min-height: 79px;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid #e5e7eb;
  }

  .transaction-list-item > div:first-child {
    min-width: 0;
  }

  .transaction-list-item strong {
    color: #0f1729;
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
  }

  .transaction-list-item p {
    overflow: hidden;
    margin-top: 0;
    color: #6b7280;
    font-size: 12px;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .transaction-list-meta {
    display: grid;
    flex: 0 0 auto;
    justify-items: end;
    gap: 6px;
  }

  .transaction-list-meta strong {
    white-space: nowrap;
  }
}
</style>
