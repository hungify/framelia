export const demoRuns = [
  {
    route: "Order #NS-1048",
    score: "Ready",
    status: "Pack next",
    time: "2 min ago",
    color: "mint",
  },
  {
    route: "Order #NS-1047",
    score: "In transit",
    status: "On track",
    time: "18 min ago",
    color: "mint",
  },
  {
    route: "SKU · Linen overshirt",
    score: "03 left",
    status: "Restock",
    time: "Yesterday",
    color: "coral",
  },
] as const;

export const demoMetrics = [
  { label: "Open orders", value: "38", detail: "12 ready to pack", tone: "mint" },
  { label: "Shipped today", value: "124", detail: "+18 from yesterday", tone: "blue" },
  { label: "Needs attention", value: "03", detail: "2 low-stock items", tone: "coral" },
] as const;

export const activity = [
  { label: "Warehouse A", value: "82%", detail: "Pick list in progress", tone: "mint" },
  { label: "Returns", value: "04", detail: "Need your review", tone: "coral" },
  { label: "Weekly sales", value: "+18%", detail: "Best week this month", tone: "blue" },
] as const;
