import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { authQueryOptions } from "#/lib/auth/queries.ts";

export const Route = createFileRoute("/_guest")({
  component: RouteComponent,
  beforeLoad: async ({ context }) => {
    // Redirect path when user is already present,
    // or after successful login/signup
    const REDIRECT_URL = "/app";

    const user = await context.queryClient.ensureQueryData({
      ...authQueryOptions(),
      revalidateIfStale: true,
    });
    if (user) {
      throw redirect({ to: REDIRECT_URL });
    }

    return { redirectUrl: REDIRECT_URL };
  },
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
