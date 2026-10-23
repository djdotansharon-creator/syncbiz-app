import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import "@/components/jingles-control/jingles-control.css";
import { AppShell } from "@/components/app-shell";
import { AppProviders } from "./providers";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getActiveSuspensionForUser } from "@/lib/auth/suspension";

/**
 * App shell layout — wraps every page in `app/(app)/*`.
 *
 * V1 Week 3 adds suspension enforcement here, gated by the
 * `SYNCBIZ_ENFORCE_SUSPENSION` env flag. The check is a no-op when the
 * flag is off (helper returns null), so non-pilot environments behave
 * exactly as before. The platform `SUPER_ADMIN` always bypasses — see
 * `lib/auth/suspension.ts`.
 *
 * Why here (not middleware): Next.js middleware runs on the Edge runtime
 * by default and cannot use Prisma. This server-component layout already
 * runs on Node and is the single chokepoint for every protected app
 * route (every directory listed under `PROTECTED_PREFIXES` in
 * `middleware.ts` lives under `app/(app)/`).
 */

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUserFromCookies();
  if (user) {
    const suspension = await getActiveSuspensionForUser(user);
    if (suspension) {
      redirect("/suspended");
    }
  }

  return (
    <AppProviders>
      <div className="flex min-h-screen flex-col">
        <AppShell>{children}</AppShell>
      </div>
    </AppProviders>
  );
}
