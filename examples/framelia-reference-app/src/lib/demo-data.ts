export const dashboardStats = [
  {
    label: "Revenue",
    value: "$248,900",
    trendDirection: "up",
    trendLabel: "+12.4%",
    detail: "vs. $221,400 last month",
  },
  {
    label: "Active users",
    value: "18,204",
    trendDirection: "up",
    trendLabel: "+8.1%",
    detail: "1,362 new this month",
  },
  {
    label: "Growth rate",
    value: "5.7%",
    trendDirection: "up",
    trendLabel: "+1.2 pts",
    detail: "Compounding weekly",
  },
  {
    label: "Churn",
    value: "1.9%",
    trendDirection: "down",
    trendLabel: "-0.4 pts",
    detail: "41 accounts cancelled",
  },
] as const;

export const recentTransactions = [
  {
    customer: "Nora Whitfield",
    email: "nora@northwind.io",
    invoice: "INV-2451",
    plan: "Scale",
    status: "paid",
    date: "Sep 14, 2026",
    amount: "$1,240.00",
  },
  {
    customer: "Elias Bergman",
    email: "elias@lumenlabs.co",
    invoice: "INV-2450",
    plan: "Growth",
    status: "paid",
    date: "Sep 13, 2026",
    amount: "$480.00",
  },
  {
    customer: "Priya Raman",
    email: "priya@corvidhq.com",
    invoice: "INV-2449",
    plan: "Growth",
    status: "pending",
    date: "Sep 13, 2026",
    amount: "$480.00",
  },
  {
    customer: "Marcus Ilo",
    email: "marcus@arclight.dev",
    invoice: "INV-2448",
    plan: "Starter",
    status: "failed",
    date: "Sep 12, 2026",
    amount: "$120.00",
  },
  {
    customer: "Sofia Duarte",
    email: "sofia@meridian.app",
    invoice: "INV-2447",
    plan: "Scale",
    status: "paid",
    date: "Sep 11, 2026",
    amount: "$1,240.00",
  },
  {
    customer: "Tobias Renner",
    email: "tobias@fernwork.io",
    invoice: "INV-2446",
    plan: "Starter",
    status: "paid",
    date: "Sep 10, 2026",
    amount: "$120.00",
  },
] as const;

export type TransactionStatus = (typeof recentTransactions)[number]["status"];

export const projectStats = [
  { label: "Active projects", value: "6" },
  { label: "Completed", value: "24" },
  { label: "Team members", value: "12" },
] as const;

export const demoProjects = [
  {
    name: "Northwind Rebrand",
    description: "Refreshed identity, marketing site, and design tokens for launch.",
    status: "on-track",
    progress: 78,
    members: ["AL", "EB", "PR"],
    updated: "Updated 2 hours ago",
  },
  {
    name: "Mobile App v3",
    description: "Offline sync, new onboarding, and a redesigned project feed.",
    status: "at-risk",
    progress: 46,
    members: ["MI", "SD"],
    updated: "Updated yesterday",
  },
  {
    name: "Billing Migration",
    description: "Move invoicing and plan management onto the new billing service.",
    status: "on-track",
    progress: 92,
    members: ["TR", "AL", "MI", "PR"],
    updated: "Updated 3 days ago",
  },
  {
    name: "Design System 2.0",
    description: "Component audit, token rename, and documentation refresh.",
    status: "on-track",
    progress: 34,
    members: ["SD", "EB"],
    updated: "Updated 4 days ago",
  },
  {
    name: "Onboarding Revamp",
    description: "Shorter signup flow with guided workspace setup checklists.",
    status: "complete",
    progress: 100,
    members: ["PR", "TR"],
    updated: "Updated last week",
  },
  {
    name: "Support Portal",
    description: "Self-serve help centre with ticket history and status pages.",
    status: "on-track",
    progress: 18,
    members: ["AL", "MI"],
    updated: "Updated last week",
  },
] as const;

export type ProjectStatus = (typeof demoProjects)[number]["status"];
