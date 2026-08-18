import { useRouter } from "@tanstack/react-router";

import { Button } from "#/components/ui/button.tsx";
import { clearMockUser } from "#/lib/mock-auth.ts";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      onClick={() => {
        clearMockUser();
        void router.navigate({ to: "/login" });
      }}
      type="button"
      className="w-fit"
      variant="destructive"
      size="lg"
    >
      Sign out
    </Button>
  );
}
