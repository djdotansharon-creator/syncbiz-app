/**
 * Real Access Control page.
 *
 * Renders the connected `AccessControlConsole`, which talks to /api/admin/users
 * (GET / POST / PATCH / DELETE) and /api/branches. The premium console design
 * is the single, canonical user-management UI for both the web app and the
 * Electron desktop wrapper (which loads the same Next.js page).
 */
import { AccessControlConsole } from "@/components/access-control-console";
import { JoinPeoplePanel } from "@/components/join/join-people-panel";
import { ManagementGate } from "@/components/management/management-gate";
import { ManagementTabs } from "@/components/management/management-tabs";

export default function AccessControlPage() {
  return (
    // Management Mode: full screen, outside the player workspace rails — this page scrolls on its own (like Control Room)
    // Security hotfix 2026-10-13: managers only; locked on a desktop station until unlocked.
    <ManagementGate from="/access-control">
      <div className="mgmt-type h-full overflow-y-auto p-4 sm:p-6">
        <div className="mb-4"><ManagementTabs /></div>
        <JoinPeoplePanel />
        <AccessControlConsole />
      </div>
    </ManagementGate>
  );
}
