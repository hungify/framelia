import { SiGithub, SiGoogle } from "@icons-pack/react-simple-icons";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon, EyeIcon, EyeOffIcon, LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { SignInSocialButton } from "#/components/sign-in-social-button.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { toast } from "#/components/ui/toast.tsx";
import { setMockUser } from "#/lib/mock-auth.ts";

export const Route = createFileRoute("/_guest/signup")({
  component: SignupForm,
});

function SignupForm() {
  const { redirectUrl } = Route.useRouteContext();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordHasLength = password.length >= 8;
  const passwordHasNumber = /\d/.test(password);
  const passwordHasSymbol = /[^A-Za-z0-9]/.test(password);
  const strengthSegments =
    password.length === 0 ? 0 : passwordHasLength && passwordHasNumber && passwordHasSymbol ? 4 : 2;
  const passwordHint =
    strengthSegments === 4
      ? "Password strength: Very strong"
      : "Use 8+ characters with a number and a symbol";

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;

    const formData = new FormData(event.currentTarget);
    const name = formData.get("name");
    const email = formData.get("email");
    const formPassword = formData.get("password");
    const confirmPassword = formData.get("confirm_password");

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof formPassword !== "string" ||
      typeof confirmPassword !== "string" ||
      !name ||
      !email ||
      !formPassword ||
      !confirmPassword
    ) {
      return;
    }

    if (formPassword !== confirmPassword) {
      toast.add({ type: "error", description: "Passwords do not match." });
      return;
    }

    if (formData.get("terms") !== "on") {
      toast.add({ type: "error", description: "Accept Terms of Service and Privacy Policy." });
      return;
    }

    setIsPending(true);
    setMockUser({ name, email });
    void navigate({ to: redirectUrl });
  };

  return (
    <div className="flex flex-col">
      <div className="flex h-[148px] flex-col items-start text-left md:h-[140px] md:items-center md:text-center">
        <div className="flex size-10 items-center justify-center rounded-[10px] bg-[#2463eb] text-base font-bold text-white">
          F
        </div>
        <h1 className="mt-[14px] text-2xl leading-8 font-semibold tracking-[-0.6px] text-[#0f1729]">
          Create your account
        </h1>
        <p className="mt-0.5 text-sm leading-5 text-[#6b7280]">
          Start building with Framelia — free for 14 days.
        </p>
      </div>

      <div className="rounded-[14px] border-0 bg-transparent p-0 shadow-none md:border md:border-[#e5e7eb] md:bg-white md:p-8 md:shadow-[0_8px_12px_rgba(255,255,255,1),0_1px_1px_rgba(255,255,255,1)]">
        <form className="flex flex-col" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4">
            <label
              className="flex h-[70px] flex-col gap-1.5 text-sm leading-5 font-medium text-[#0f1729]"
              htmlFor="name"
            >
              Full name
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Ada Lovelace"
                readOnly={isPending}
                required
                className="h-11 rounded-lg border-[#e5e7eb] bg-white px-[15px] py-[11px] text-sm leading-5 text-[#0f1729] shadow-none placeholder:text-[#9ca3af] focus-visible:border-[#2463eb] focus-visible:ring-[#2463eb]/20"
              />
            </label>

            <label
              className="flex h-[70px] flex-col gap-1.5 text-sm leading-5 font-medium text-[#0f1729]"
              htmlFor="email"
            >
              Email
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@company.com"
                readOnly={isPending}
                required
                className="h-11 rounded-lg border-[#e5e7eb] bg-white px-[15px] py-[11px] text-sm leading-5 text-[#0f1729] shadow-none placeholder:text-[#9ca3af] focus-visible:border-[#2463eb] focus-visible:ring-[#2463eb]/20"
              />
            </label>

            <div className="flex h-[104px] flex-col">
              <div className="flex h-[70px] flex-col gap-1.5">
                <label
                  className="h-5 text-sm leading-5 font-medium text-[#0f1729]"
                  htmlFor="password"
                >
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
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
              <div className="mt-2 flex h-[26px] flex-col gap-1.5">
                <div className="flex h-1 gap-1.5" aria-hidden="true">
                  {[0, 1, 2, 3].map((segment) => (
                    <span
                      key={segment}
                      className={`h-1 flex-1 rounded-full ${segment < strengthSegments ? "bg-[#2463eb]" : "bg-[#e5e7eb]"}`}
                    />
                  ))}
                </div>
                <p className="text-xs leading-4 text-[#6b7280]">{passwordHint}</p>
              </div>
            </div>

            <div className="flex h-[70px] flex-col">
              <div className="flex h-[70px] flex-col gap-1.5">
                <label
                  className="h-5 text-sm leading-5 font-medium text-[#0f1729]"
                  htmlFor="confirm_password"
                >
                  Confirm password
                </label>
                <div className="relative">
                  <Input
                    id="confirm_password"
                    name="confirm_password"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="••••••••"
                    readOnly={isPending}
                    required
                    className="h-11 rounded-lg border-[#e5e7eb] bg-white px-[15px] py-[11px] pr-12 text-sm leading-5 text-[#0f1729] shadow-none placeholder:text-[#9ca3af] focus-visible:border-[#2463eb] focus-visible:ring-[#2463eb]/20"
                  />
                  <button
                    type="button"
                    aria-label={
                      showConfirmPassword ? "Hide confirm password" : "Show confirm password"
                    }
                    className="absolute top-1.5 right-1 flex size-8 items-center justify-center rounded-md text-[#6b7280] hover:bg-[#f3f4f6]"
                    onClick={() => setShowConfirmPassword((visible) => !visible)}
                  >
                    {showConfirmPassword ? (
                      <EyeOffIcon className="size-4" />
                    ) : (
                      <EyeIcon className="size-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 flex h-10 items-start gap-2">
            <span className="relative mt-0.5 size-4 shrink-0">
              <input
                id="terms"
                name="terms"
                type="checkbox"
                required
                className="peer size-4 appearance-none rounded-[3px] border border-[#e5e7eb] bg-white checked:border-[#2463eb] checked:bg-[#2463eb]"
              />
              <CheckIcon className="pointer-events-none absolute inset-0 hidden size-4 p-0.5 text-white peer-checked:block" />
            </span>
            <label className="text-sm leading-5 text-[#6b7280]" htmlFor="terms">
              I agree to the{" "}
              <a
                href="https://ui.shadcn.com/terms"
                target="_blank"
                className="font-medium text-[#2463eb] hover:underline"
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="https://ui.shadcn.com/privacy"
                target="_blank"
                className="block font-medium text-[#2463eb] hover:underline"
              >
                Privacy Policy
              </a>
            </label>
          </div>

          <Button
            type="submit"
            className="mt-5 h-11 w-full rounded-lg bg-[#2463eb] px-4 py-3 text-sm leading-5 font-medium text-white shadow-[0_1px_1px_rgba(0,0,0,0.05)] hover:bg-[#1d56d4]"
            disabled={isPending}
          >
            {isPending && <LoaderCircleIcon className="animate-spin" />}
            {isPending ? "Creating..." : "Create account"}
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
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-[#2463eb] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
