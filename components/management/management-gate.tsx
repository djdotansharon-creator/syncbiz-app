/**
 * MANAGEMENT GATE (server, owner 2026-10-13 security hotfix) — wraps every management page (Dashboard, Control Room,
 * Access Control): not signed in → login · not a manager → the player (/sources) · desktop station and locked →
 * the lock screen · otherwise the page (+ the desktop inactivity tracker).
 */
import { redirect } from "next/navigation";
import { getManagementAccess, getStationLockState } from "@/lib/management-access";
import { ManagementActivity, ManagementLockScreen } from "@/components/management/management-lock";

export async function ManagementGate({ from, children }: { from: string; children: React.ReactNode }) {
  const a = await getManagementAccess();
  if (!a.signedIn) redirect(`/login?from=${encodeURIComponent(from)}`);
  if (!a.canManage) redirect("/sources");
  if (!a.unlocked) return <ManagementLockScreen />;
  return (
    <>
      {a.desktop ? <ManagementActivity /> : null}
      {children}
    </>
  );
}

/** Settings (owner 2026-10-29): on the player computer (desktop app) it asks for the access code; a browser goes straight in. Unlike ManagementGate it is NOT manager-only (language, display, local music are for whoever has the code). */
export async function SettingsGate({ from, children }: { from: string; children: React.ReactNode }) {
  const s = await getStationLockState();
  if (!s.signedIn) redirect(`/login?from=${encodeURIComponent(from)}`);
  if (!s.unlocked) return <ManagementLockScreen />;
  return (
    <>
      {s.desktop ? <ManagementActivity /> : null}
      {children}
    </>
  );
}
