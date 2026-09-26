import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  BellIcon,
  ChevronsUpDownIcon,
  FolderKanbanIcon,
  HomeIcon,
  SearchIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { NorthstarBrand } from "#/components/northstar-brand.tsx";
import { SignOutButton } from "#/components/sign-out-button.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "#/components/ui/sidebar.tsx";
import { useAuth } from "#/lib/auth/hooks.ts";
import { cn } from "#/lib/utils.ts";

export const Route = createFileRoute("/_auth/app")({
  component: AppLayout,
});

function AppLayout() {
  const location = useLocation();
  const activeSettings = location.pathname.includes("settings");
  const activeProjects = location.pathname.includes("projects");
  const { user } = useAuth();
  const initials = (user?.name ?? "Ada Lovelace")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const navigation = [
    { label: "Home", icon: HomeIcon, to: "/app", active: !activeSettings && !activeProjects },
    {
      label: "Projects",
      icon: FolderKanbanIcon,
      to: "/app/projects",
      active: activeProjects,
      count: 6,
    },
    { label: "Team", icon: UsersIcon, to: "/app", active: false },
    { label: "Settings", icon: Settings2Icon, to: "/app/settings", active: activeSettings },
  ] as const;

  return (
    <SidebarProvider
      className="dashboard-shell"
      style={{ "--sidebar-width": "259px" } as CSSProperties}
    >
      <Sidebar
        collapsible="offcanvas"
        className="!border-r-0 [&>[data-slot=sidebar-inner]]:!bg-white [&>[data-slot=sidebar-inner]]:!text-[#0f1729]"
      >
        <SidebarHeader className="h-16 shrink-0 p-0">
          <div className="flex h-16 items-center px-5">
            <NorthstarBrand />
          </div>
        </SidebarHeader>
        <SidebarContent className="gap-0">
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5 px-3 pt-2" aria-label="Workspace navigation">
                {navigation.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        render={<Link to={item.to} />}
                        isActive={item.active}
                        className={cn(
                          index === 1 ? "h-10" : "h-9",
                          "gap-3 rounded-lg px-2.5 text-sm text-[#6b7280] hover:bg-[#f3f4f6] hover:text-[#0f1729] data-active:bg-[#f3f4f6] data-active:text-[#0f1729]",
                        )}
                      >
                        <Icon className="size-4" strokeWidth={2} />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {"count" in item && item.count ? (
                        <SidebarMenuBadge className="top-2 right-2 h-6 min-w-6 rounded-full bg-[#f3f4f6] px-0 text-[11px] text-[#6b7280]">
                          {item.count}
                        </SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-[#e5e7eb] p-3">
          <button
            type="button"
            className="flex h-[54px] w-full items-center gap-2.5 rounded-lg border border-[#e5e7eb] bg-white px-2 text-left"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2463eb]/10 text-xs font-semibold text-[#2463eb]">
              {initials}
            </span>
            <span className="grid h-9 min-w-0 flex-1">
              <strong className="truncate text-sm leading-5 font-medium text-[#0f1729]">
                {user?.name ?? "Ada Lovelace"}
              </strong>
              <small className="truncate text-xs leading-4 text-[#6b7280]">
                {user?.email ?? "ada@company.com"}
              </small>
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 text-[#6b7280]" strokeWidth={2} />
          </button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-svh bg-[#f9fafb]">
        <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[#e5e7eb] bg-white px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <SidebarTrigger className="-ml-2 md:hidden" />
            <div className="md:hidden">
              <NorthstarBrand compact />
            </div>
            <div className="relative hidden w-full max-w-96 md:block">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#9ca3af]" />
              <Input
                type="search"
                placeholder="Search customers, invoices…"
                className="h-9 rounded-lg border-[#e5e7eb] bg-[#f9fafb] pl-9 text-sm text-[#0f1729] placeholder:text-[#9ca3af] focus-visible:ring-[#2463eb]/30"
              />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Notifications"
              className="relative flex size-9 items-center justify-center rounded-lg hover:bg-[#f3f4f6]"
            >
              <BellIcon className="size-[18px] text-[#0f1729]" strokeWidth={2} />
              <span className="absolute top-2 right-2 size-2 rounded-full border-2 border-white bg-[#2463eb]" />
            </button>
            <span className="flex size-9 items-center justify-center rounded-full bg-[#2463eb]/10 text-xs font-semibold text-[#2463eb]">
              {initials}
            </span>
            <SignOutButton />
          </div>
        </div>
        <main className="mx-auto w-full max-w-6xl px-8 py-8">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
