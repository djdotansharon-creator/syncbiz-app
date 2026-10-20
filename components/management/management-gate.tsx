/**
 * MANAGEMENT GATE (server, owner 2026-10-13 security hotfix) — wraps every management page (Dashboard, Control Room,
 * Access Control): not signed in → login · not a manager → the player (/sources) · desktop station and locked →
 * the lock screen · otherwise the page (+ the desktop inactivity tracker).
 */
import { redirect } from "next/navigation";
import { getManagementAccess } from "@/lib/management-access";
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
