import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import "@/components/jingles-control/jingles-control.css";
import { AppShell } from "@/components/app-shell";
import { EditModalHost } from "@/components/edit-modal-host";
import { UndoToastHost } from "@/components/undo-toast-host";
import { AppProviders } from "./providers";
import { getLocale } from "@/lib/locale-server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getActiveSuspensionForUser } from "@/lib/auth/suspension";
import { EnrollmentHold } from "@/components/enrollment-hold";
import { isDesktopShellUserAgent } from "@/lib/device-enrollment";
import { getEnrollmentConfig } from "@/lib/device-enrollment-store";
import { isRolesEnvEnabled, blocksComputer } from "@/lib/roles";
import { getMemberRole } from "@/lib/roles-store";
import { isPhoneUa } from "@/lib/ua-detection";
import { ComputerBlocked } from "@/components/roles/computer-blocked";
import { RoleLanding } from "@/components/control-screen/role-landing";

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

  // Roles (owner 2026-10-29): a person whose role does not allow signing in from a COMPUTER sees only a notice on a computer. Off by default (SYNCBIZ_ROLES=1); only people GIVEN a role are affected; a phone and the
  // desktop app are never blocked; any failure here lets the person in (never locks anyone out).
  let computerBlocked = false;
  let landOnControl = false; // a role that opens the Control Room lands on the control screen (browser only)
  if (user && isRolesEnvEnabled()) {
    try {
      const ua = (await headers()).get("user-agent") ?? "";
      if (!isPhoneUa(ua) && !isDesktopShellUserAgent(ua)) {
        const role = await getMemberRole(user.tenantId, user.id);
        computerBlocked = blocksComputer(role, { phone: false, desktopApp: false });
        landOnControl = !computerBlocked && role?.openControlRoom === true;
      }
    } catch (e) {
      console.error("[roles] computer check failed — letting the person in", e instanceof Error ? e.message : String(e));
    }
  }
  if (computerBlocked) return <ComputerBlocked />;

  // Device approval (owner 2026-10-28): when this workspace has enrollment on, a browser / phone is held at the request screen until a manager approves it — the app is not even mounted.
  // Off by default (needs the env flag AND the workspace switch — getEnrollmentConfig answers "off" without touching the database while the env flag is off); never throws; the desktop app is never held.
  let enrollmentEnforced = false;
  if (user) {
    try {
      const ua = (await headers()).get("user-agent");
      if (!isDesktopShellUserAgent(ua)) enrollmentEnforced = (await getEnrollmentConfig(user.tenantId)).enabled;
    } catch (e) {
      console.error("[device-enrollment] layout check failed — not holding the app", e instanceof Error ? e.message : String(e));
    }
  }

  // the language the root layout already rendered <html lang dir> in: the app's own texts are drawn in it from the very first frame
  const locale = await getLocale();

  return (
    <EnrollmentHold enforced={enrollmentEnforced}>
      <AppProviders locale={locale}>
        <div className="flex min-h-screen flex-col">
          {landOnControl ? <RoleLanding /> : null}
          <AppShell>{children}</AppShell>
          <EditModalHost />
          <UndoToastHost />
        </div>
      </AppProviders>
    </EnrollmentHold>
  );
}
