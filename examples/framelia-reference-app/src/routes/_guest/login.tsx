import { SiGithub, SiGoogle } from "@icons-pack/react-simple-icons";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { SignInSocialButton } from "#/components/sign-in-social-button.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { setMockUser } from "#/lib/mock-auth.ts";

export const Route = createFileRoute("/_guest/login")({
  component: LoginForm,
});

function LoginForm() {
  const { redirectUrl } = Route.useRouteContext();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;

    const formData = new FormData(event.currentTarget);
    const email = formData.get("email");
    const password = formData.get("password");

    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return;
    }

    setIsPending(true);
    setMockUser({ name: email.split("@")[0] || "Demo User", email });
    void navigate({ to: redirectUrl });
  };

  return (
    <div className="flex flex-col">
      <div className="flex h-[148px] flex-col items-start text-left md:h-[140px] md:items-center md:text-center">
        <div className="flex size-10 items-center justify-center rounded-[10px] bg-[#2463eb] text-base font-bold text-white">
          F
        </div>
        <h1 className="mt-[14px] text-2xl leading-8 font-semibold tracking-[-0.6px] text-[#0f1729]">
          Sign in to Framelia
        </h1>
        <p className="mt-0.5 text-sm leading-5 text-[#6b7280]">
          Welcome back. Enter your details to continue.
        </p>
      </div>

      <div className="rounded-[14px] border-0 bg-transparent p-0 shadow-none md:border md:border-[#e5e7eb] md:bg-white md:p-8 md:shadow-[0_8px_12px_rgba(255,255,255,1),0_1px_1px_rgba(255,255,255,1)]">
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4">
            <label
              className="flex h-[70px] flex-col gap-1.5 text-sm leading-5 font-medium text-[#0f1729]"
              htmlFor="email"
            >
              Email
              <Input
                data-testid="login-email"
                id="email"
                name="email"
                type="email"
                aria-label="Email"
                placeholder="you@company.com"
                readOnly={isPending}
                required
                className="h-11 rounded-lg border-[#e5e7eb] bg-white px-[15px] py-[11px] text-sm leading-5 text-[#0f1729] shadow-none placeholder:text-[#9ca3af] focus-visible:border-[#2463eb] focus-visible:ring-[#2463eb]/20"
              />
            </label>

            <div className="flex h-[70px] flex-col gap-1.5">
              <div className="flex h-5 items-center justify-between text-sm leading-5 font-medium">
                <label className="text-[#0f1729]" htmlFor="password">
                  Password
                </label>
                <button type="button" className="text-[#2463eb] hover:underline">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  data-testid="login-password"
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  aria-label="Password"
                  placeholder="••••••••"
                  readOnly={isPending}
                  required
                  className="h-11 rounded-lg border-[#e5e7eb] bg-white px-[15px] py-[11px] pr-12 text-sm leading-5 text-[#0f1729] shadow-none placeholder:text-[#9ca3af] focus-visible:border-[#2463eb] focus-visible:ring-[#2463eb]/20"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute top-1.5 right-1 flex size-8 items-center justify-center rounded-md text-[#6b7280] hover:bg-[#f3f4f6]"
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? (
                    <EyeOffIcon className="size-4" />
                  ) : (
                    <EyeIcon className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <label className="mt-5 flex h-5 items-center gap-2 text-sm leading-5 text-[#6b7280]">
            <input
              type="checkbox"
              name="remember"
              defaultChecked
              className="size-4 rounded-[3px] accent-[#2463eb]"
            />
            Remember me for 30 days
          </label>

          <Button
            type="submit"
            className="mt-5 h-11 w-full rounded-lg bg-[#2463eb] px-4 py-3 text-sm leading-5 font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)] hover:bg-[#1d56d4]"
            disabled={isPending}
          >
            {isPending && <LoaderCircleIcon className="animate-spin" />}
            {isPending ? "Signing in..." : "Sign in"}
          </Button>

          <div className="mt-5 flex h-4 items-center gap-3 text-xs leading-4 font-medium tracking-[0.3px] text-[#6b7280]">
            <span className="h-px flex-1 bg-[#e5e7eb]" />
            <span className="whitespace-nowrap">or continue with</span>
            <span className="h-px flex-1 bg-[#e5e7eb]" />
          </div>

          <div className="mt-5 flex flex-col gap-3 md:flex-row md:gap-3">
            <SignInSocialButton
              provider="google"
              callbackURL={redirectUrl}
              disabled={isPending}
              icon={<SiGoogle className="size-4 text-[#4285F4]" />}
              label="Google"
              variant="outline"
              className="h-11 rounded-lg border-[#e5e7eb] bg-white px-4 py-3 text-sm leading-5 font-medium text-[#0f1729] shadow-none hover:bg-[#f9fafb] md:w-[171px]"
            />
            <SignInSocialButton
              provider="github"
              callbackURL={redirectUrl}
              disabled={isPending}
              icon={<SiGithub className="size-4" />}
              label="GitHub"
              variant="outline"
              className="h-11 rounded-lg border-[#e5e7eb] bg-white px-4 py-3 text-sm leading-5 font-medium text-[#0f1729] shadow-none hover:bg-[#f9fafb] md:w-[171px]"
            />
          </div>
        </form>
      </div>

      <p className="mt-0 h-[52px] pt-8 text-center text-sm leading-5 text-[#6b7280] md:mt-6 md:h-5 md:pt-0">
        Don't have an account?{" "}
        <Link to="/signup" className="font-medium text-[#2463eb] hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
