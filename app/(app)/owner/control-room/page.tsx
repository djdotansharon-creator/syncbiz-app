import { AllBranchesView } from "@/components/control-room/all-branches-view";
import { ManagementGate } from "@/components/management/management-gate";

/** CONTROL ROOM — step 1: all branches in one place (read-only live view), full width (outside the player workspace
 *  rails — no library / playlists columns). Lives under /owner so the existing
 *  app-shell / device-socket rules for /owner apply unchanged. */
export default function ControlRoomPage() {
  // Management area (security hotfix 2026-10-13): managers only; locked on a desktop station until unlocked.
  // The app main area is a fixed-height region (overflow hidden on large screens) — this page scrolls on its own.
  return (
    <ManagementGate from="/owner/control-room">
      <div className="mgmt-type h-full overflow-y-auto">
        <AllBranchesView />
      </div>
    </ManagementGate>
  );
}
