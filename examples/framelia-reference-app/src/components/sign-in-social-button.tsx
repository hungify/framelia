import { useState } from "react";

import { Button } from "#/components/ui/button.tsx";
import { setMockUser } from "#/lib/mock-auth.ts";
import { cn } from "#/lib/utils.ts";

interface SocialLoginButtonProps {
  provider: string;
  icon: React.ReactNode;
  disabled?: boolean;
  callbackURL: string;
  className?: string;
  label?: string;
  variant?: "secondary" | "outline";
}

export function SignInSocialButton(props: SocialLoginButtonProps) {
  const providerLabel =
    props.provider === "github"
      ? "GitHub"
      : props.provider.charAt(0).toUpperCase() + props.provider.slice(1);

  const [isPending, setIsPending] = useState(false);

  return (
    <Button
      variant={props.variant ?? "secondary"}
      className={cn("w-full", props.className)}
      type="button"
      disabled={isPending || props.disabled}
      onClick={() => {
        setIsPending(true);
        setMockUser({
          name: `${providerLabel} User`,
          email: `${props.provider}@framelia.local`,
        });
        window.location.assign(props.callbackURL);
      }}
    >
      {props.icon}
      {props.label ?? `Login with ${providerLabel}`}
    </Button>
  );
}
