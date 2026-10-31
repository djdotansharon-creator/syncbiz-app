/**
 * The Permissions page (owner 2026-10-31, "like Discord"): People and Roles — see components/roles/permissions-hub.tsx. Managers only.
 */
import { PermissionsHub } from "@/components/roles/permissions-hub";
import { ManagementGate } from "@/components/management/management-gate";
import { ManagementTabs } from "@/components/management/management-tabs";

export default function AccessControlPage() {
  return (
    // Management Mode: full screen, outside the player workspace rails — this page scrolls on its own (like Control Room)
    // Security hotfix 2026-10-13: managers only; locked on a desktop station until unlocked.
    <ManagementGate from="/access-control">
      <div className="mgmt-type h-full overflow-y-auto p-4 sm:p-6">
        <div className="mb-4"><ManagementTabs /></div>
        {/* owner 2026-10-31: People (squares) and Roles are the whole screen — the old roles table and the old user console are gone */}
        <PermissionsHub />
      </div>
    </ManagementGate>
  );
}
