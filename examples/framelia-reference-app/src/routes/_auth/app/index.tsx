import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, PlusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { useAuth } from "#/lib/auth/hooks.ts";
import { dashboardStats, recentTransactions, type TransactionStatus } from "#/lib/demo-data.ts";
import { cn } from "#/lib/utils.ts";

export const Route = createFileRoute("/_auth/app/")({
  component: AppIndex,
});

const CHART_RANGES = ["3M", "6M", "12M"] as const;

const STATUS_STYLES: Record<TransactionStatus, string> = {
  paid: "bg-[#ecfdf5] text-[#047857]",
  pending: "bg-[#fffbeb] text-[#b45309]",
  failed: "bg-[#dc2828]/10 text-[#dc2828]",
};

const STATUS_LABELS: Record<TransactionStatus, string> = {
  paid: "Paid",
  pending: "Pending",
  failed: "Failed",
};

function AppIndex() {
  const { user } = useAuth();
  const [chartRange, setChartRange] = useState<(typeof CHART_RANGES)[number]>("12M");

  return (
    <div className="space-y-6" data-testid="dashboard-page">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-.015em] text-[#0f1729]">
            Welcome back, {user?.name?.split(" ")[0] ?? "friend"}
          </h1>
          <p className="mt-1 text-sm text-[#6b7280]">
            Here&apos;s how Framelia is performing in September 2026.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="lg"
            className="rounded-[8px] border-[#e5e7eb] text-[#0f1729]"
          >
            <DownloadIcon /> Export
          </Button>
          <Button size="lg" className="rounded-[8px] bg-[#2463eb] text-white hover:bg-[#2463eb]/90">
            <PlusIcon /> New project
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2" aria-label="Workspace metrics">
        {dashboardStats.map((stat) => (
          <div
            key={stat.label}
            className={cn(
              "rounded-[14px] border border-[#e5e7eb] bg-white p-5",
              stat.label === "Revenue" && "md:col-span-2",
            )}
          >
            <p className="text-sm text-[#6b7280]">{stat.label}</p>
            <p
              className={cn(
                "mt-3 font-semibold tracking-[-.02em] text-[#0f1729]",
                stat.label === "Revenue" ? "text-[30px]" : "text-2xl",
              )}
            >
              {stat.value}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-xs font-medium text-[#047857]">
                {stat.trendDirection === "up" ? (
                  <TrendingUpIcon className="size-3" />
                ) : (
                  <TrendingDownIcon className="size-3" />
                )}
                {stat.trendLabel}
              </span>
              <span className="text-xs text-[#6b7280]">{stat.detail}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-[14px] border border-[#e5e7eb] bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-[-.01em] text-[#0f1729]">Revenue</h2>
            <p className="mt-1 text-sm text-[#6b7280]">Monthly recurring revenue vs. target</p>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg border border-[#e5e7eb] p-0.5">
            {CHART_RANGES.map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setChartRange(range)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  chartRange === range
                    ? "bg-[#f3f4f6] text-[#0f1729]"
                    : "text-[#6b7280] hover:text-[#0f1729]",
                )}
              >
                {range}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-6 h-64" aria-hidden="true" />
      </section>

      <section className="rounded-[14px] border border-[#e5e7eb] bg-white">
        <div className="flex items-center justify-between border-b border-[#e5e7eb] px-6 py-5">
          <div>
            <h2 className="text-base font-semibold tracking-[-.01em] text-[#0f1729]">
              Recent transactions
            </h2>
            <p className="mt-1 text-sm text-[#6b7280]">Last 6 invoices across all workspaces</p>
          </div>
          <Button variant="link" className="text-[#2463eb]">
            View all
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e7eb]">
                <th className="px-6 py-3 text-left text-xs font-bold tracking-[.03em] text-[#6b7280] uppercase">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold tracking-[.03em] text-[#6b7280] uppercase">
                  Invoice
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold tracking-[.03em] text-[#6b7280] uppercase">
                  Plan
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold tracking-[.03em] text-[#6b7280] uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-bold tracking-[.03em] text-[#6b7280] uppercase">
                  Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-bold tracking-[.03em] text-[#6b7280] uppercase">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map((transaction, index) => (
                <tr
                  key={transaction.invoice}
                  className={cn(
                    index < recentTransactions.length - 1 && "border-b border-[#e5e7eb]",
                  )}
                >
                  <td className="px-6 py-3.5">
                    <p className="font-medium text-[#0f1729]">{transaction.customer}</p>
                    <p className="text-xs text-[#6b7280]">{transaction.email}</p>
                  </td>
                  <td className="px-6 py-3.5 text-[#6b7280]">{transaction.invoice}</td>
                  <td className="px-6 py-3.5 text-[#6b7280]">{transaction.plan}</td>
                  <td className="px-6 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_STYLES[transaction.status as TransactionStatus],
                      )}
                    >
                      {STATUS_LABELS[transaction.status as TransactionStatus]}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-[#6b7280]">{transaction.date}</td>
                  <td className="px-6 py-3.5 text-right font-medium text-[#0f1729]">
                    {transaction.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
