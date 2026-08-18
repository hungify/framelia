import { createFileRoute } from "@tanstack/react-router";
import { SaveIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { useMockUser } from "#/lib/mock-auth.ts";

export const Route = createFileRoute("/_auth/app/settings")({ component: SettingsPage });

function SettingsPage() {
  const { user } = useMockUser();
  return (
    <div className="mx-auto max-w-3xl space-y-8" data-testid="settings-page">
      <div>
        <div className="eyebrow text-muted-foreground">
          <UserRoundIcon className="size-3" /> Workspace identity
        </div>
        <h1 className="mt-3 font-heading text-4xl font-semibold tracking-[-.07em]">
          Profile & settings
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Keep your team profile current so every handoff has a clear owner.
        </p>
      </div>
      <div className="dashboard-card">
        <div className="flex items-center gap-3 border-b border-border pb-5">
          <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--ink)] text-[var(--signal)]">
            <UserRoundIcon className="size-5" />
          </span>
          <div>
            <h2 className="font-semibold">Profile details</h2>
            <p className="text-xs text-muted-foreground">Used across your workspace</p>
          </div>
        </div>
        <form className="mt-6 grid gap-5" onSubmit={(event) => event.preventDefault()}>
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" defaultValue={user?.name} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={user?.email} readOnly />
          </div>
          <Button type="submit" className="mt-2 w-fit rounded-xl">
            <SaveIcon /> Save profile
          </Button>
        </form>
      </div>
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
        <div className="flex items-start gap-3">
          <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-emerald-700" />
          <div>
            <h2 className="font-semibold">Your account is protected</h2>
            <p className="mt-1 text-sm leading-6 text-emerald-800">
              Framelia uses local mock authentication for this demo. Sign out when you finish on a
              shared device.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
