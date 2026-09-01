import { useMutation } from "@tanstack/react-query";

import { Button } from "#/components/ui/button.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { authClient } from "#/lib/auth/auth-client.ts";
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

  const mutation = useMutation({
    mutationFn: async () =>
      await authClient.signIn.social(
        {
          provider: props.provider,
          callbackURL: props.callbackURL,
        },
        {
          onError: ({ error }) => {
            toast.add({
              type: "error",
              description: error.message || `An error occurred during ${providerLabel} sign-in.`,
            });
          },
        },
      ),
  });

  return (
    <Button
      variant={props.variant ?? "secondary"}
      className={cn("w-full", props.className)}
      type="button"
      disabled={mutation.isSuccess || mutation.isPending || props.disabled}
      onClick={() => mutation.mutate()}
    >
      {props.icon}
      {props.label ?? `Login with ${providerLabel}`}
    </Button>
  );
}
