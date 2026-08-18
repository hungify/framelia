import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import {
  ChevronsUpDownIcon,
  FolderKanbanIcon,
  HomeIcon,
  Settings2Icon,
  UsersIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

import { NorthstarBrand } from "#/components/northstar-brand.tsx";
import { SignOutButton } from "#/components/sign-out-button.tsx";
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
import { useMockUser } from "#/lib/mock-auth.ts";
import { cn } from "#/lib/utils.ts";

export const Route = createFileRoute("/_auth/app")({
  component: AppLayout,
});

function AppLayout() {
  const location = useLocation();
  const activeSettings = location.pathname.includes("settings");
  const { user } = useMockUser();
  const navigation = [
    { label: "Home", icon: HomeIcon, to: "/app", active: !activeSettings },
    { label: "Projects", icon: FolderKanbanIcon, to: "/app", active: false, count: 6 },
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
              {(user?.name ?? "Ada Lovelace")
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
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
      <SidebarInset className="min-h-svh">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="-ml-2" />
            <NorthstarBrand compact />
          </div>
          <SignOutButton />
        </div>
        <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
