import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { demoProjects, projectStats, type ProjectStatus } from "#/lib/demo-data.ts";
import { cn } from "#/lib/utils.ts";

export const Route = createFileRoute("/_auth/app/projects")({
  component: ProjectsPage,
});

const STATUS_STYLES: Record<ProjectStatus, string> = {
  "on-track": "bg-[#ecfdf5] text-[#047857]",
  "at-risk": "bg-[#fffbeb] text-[#b45309]",
  complete: "bg-[#2463eb]/10 text-[#2463eb]",
};

const STATUS_LABELS: Record<ProjectStatus, string> = {
  "on-track": "On track",
  "at-risk": "At risk",
  complete: "Complete",
};

function ProjectsPage() {
  return (
    <div className="space-y-6" data-testid="projects-page">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-.015em] text-[#0f1729]">
            My Projects
          </h1>
          <p className="mt-1 text-sm text-[#6b7280]">
            Everything your team is working on right now.
          </p>
        </div>
        <Button size="lg" className="rounded-[8px] bg-[#2463eb] text-white hover:bg-[#2463eb]/90">
          <PlusIcon /> New Project
        </Button>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3" aria-label="Project metrics">
        {projectStats.map((stat) => (
          <div key={stat.label} className="rounded-[14px] border border-[#e5e7eb] bg-white p-5">
            <p className="text-sm text-[#6b7280]">{stat.label}</p>
            <p className="mt-3 text-2xl font-semibold tracking-[-.02em] text-[#0f1729]">
              {stat.value}
            </p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-base font-semibold tracking-[-.01em] text-[#0f1729]">All projects</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {demoProjects.map((project) => (
            <div
              key={project.name}
              className="rounded-[14px] border border-[#e5e7eb] bg-white p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-semibold tracking-[-.01em] text-[#0f1729]">
                  {project.name}
                </h3>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
                    STATUS_STYLES[project.status as ProjectStatus],
                  )}
                >
                  {STATUS_LABELS[project.status as ProjectStatus]}
                </span>
              </div>
              <p className="mt-2.5 text-sm text-[#6b7280]">{project.description}</p>

              <div className="mt-7.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-[#6b7280]">Progress</span>
                  <span className="text-[#0f1729]">{project.progress}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f3f4f6]">
                  <div
                    className="h-1.5 rounded-full bg-[#2463eb]"
                    style={{ width: `${project.progress}%` }}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {project.members.map((initials) => (
                    <span
                      key={initials}
                      className="flex size-7 items-center justify-center rounded-full border-2 border-white bg-[#2463eb]/10 text-[11px] font-semibold text-[#2463eb]"
                    >
                      {initials}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-[#6b7280]">{project.updated}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
