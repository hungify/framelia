import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_guest")({
  component: RouteComponent,
  beforeLoad: () => ({ redirectUrl: "/app" }),
});

function RouteComponent() {
  return (
    <main className="min-h-svh bg-[#f9fafb] px-5 pt-10 pb-8 text-[#0f1729] md:flex md:items-center md:justify-center md:p-8">
      <div className="w-full max-w-[420px]">
        <Outlet />
      </div>
    </main>
  );
}
