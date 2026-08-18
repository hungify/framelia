import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  ScanLineIcon,
} from "lucide-react";

import { NorthstarBrand, SignalDot } from "#/components/northstar-brand.tsx";
import { activity, demoMetrics, demoRuns } from "#/lib/demo-data.ts";
import { useMockUser } from "#/lib/mock-auth.ts";

export const Route = createFileRoute("/_auth/app/")({
  component: AppIndex,
});

function AppIndex() {
  const { user } = useMockUser();

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="eyebrow text-muted-foreground">
            <SignalDot /> Tuesday, August 12, 2026
          </div>
          <h1 className="mt-3 font-heading text-4xl font-semibold tracking-[-.07em] sm:text-5xl">
            Good morning, {user?.name?.split(" ")[0] ?? "friend"}.
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
            Your team is moving well. Here is what needs your attention before lunch.
          </p>
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <span className="avatar-ring flex size-10 items-center justify-center rounded-full bg-[var(--ink)] text-sm font-semibold text-white">
            {(user?.name?.[0] ?? "D").toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-medium">{user?.name}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
      </header>
      <section className="grid gap-4 md:grid-cols-3" aria-label="Workspace metrics">
        {demoMetrics.map((metric) => (
          <div className="dashboard-card" key={metric.label}>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{metric.label}</span>
              <span className={`metric-dot metric-dot-${metric.tone}`} />
            </div>
            <p className="metric-value">{metric.value}</p>
            <p className="mt-2 text-xs text-muted-foreground">{metric.detail}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <div className="dashboard-card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border px-5 py-5">
            <div>
              <h2 className="font-semibold">Latest orders</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                A clear view of what happens next
              </p>
            </div>
            <span className="rounded-full bg-[var(--signal)]/25 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              All on track
            </span>
          </div>
          <div className="divide-y divide-border">
            {demoRuns.map((run) => (
              <div key={run.route} className="flex items-center gap-4 px-5 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <ScanLineIcon className="size-4 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{run.route}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock3Icon className="size-3" /> {run.time}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{run.score}</p>
                  <p
                    className={`mt-1 text-xs ${run.color === "coral" ? "text-[var(--coral)]" : "text-emerald-700"}`}
                  >
                    {run.status}
                  </p>
                </div>
                <ArrowUpRightIcon className="size-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        </div>
        <div className="dashboard-card">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Fulfillment health</h2>
              <p className="mt-1 text-xs text-muted-foreground">Last 24 hours</p>
            </div>
            <CheckCircle2Icon className="size-5 text-emerald-600" />
          </div>
          <div className="mt-7 flex items-end justify-between">
            <div>
              <p className="font-heading text-6xl font-semibold tracking-[-.09em]">
                96.4<span className="text-2xl text-emerald-600">%</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">on-time delivery rate</p>
            </div>
            <span className="text-xs font-semibold text-emerald-700">+2.1%</span>
          </div>
          <div className="mt-8 flex h-20 items-end gap-1.5">
            {[38, 44, 36, 56, 50, 64, 62, 71, 69, 82, 76, 94].map((height, index) => (
              <span
                key={index}
                className={`score-bar ${index === 11 ? "score-bar-active" : ""} flex-1`}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-2xl bg-muted p-3 text-xs text-muted-foreground">
            <CircleAlertIcon className="size-4 shrink-0 text-[var(--coral)]" /> 3 items need your
            review
          </div>
        </div>
      </section>
      <section className="dashboard-card">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Team activity</h2>
            <p className="mt-1 text-xs text-muted-foreground">Small signals worth seeing</p>
          </div>
          <NorthstarBrand compact />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {activity.map((item) => (
            <div key={item.label} className="rounded-2xl border border-border/70 p-4">
              <div className="flex items-center justify-between">
                <SignalDot tone={item.tone === "coral" ? "coral" : "mint"} />
                <span className="text-sm font-semibold">{item.value}</span>
              </div>
              <p className="mt-5 text-sm font-medium">{item.label}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
