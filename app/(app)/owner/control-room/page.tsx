import { redirect } from "next/navigation";
import { AllBranchesView } from "@/components/control-room/all-branches-view";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

/** CONTROL ROOM — step 1: all branches in one place (read-only live view), full width (outside the player workspace
 *  rails — no library / playlists columns). Lives under /owner so the existing
 *  app-shell / device-socket rules for /owner apply unchanged. */
export default async function ControlRoomPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?from=/owner/control-room");
  // The app main area is a fixed-height region (overflow hidden on large screens) — this page scrolls on its own.
  return (
    <div className="mgmt-type h-full overflow-y-auto">
      <AllBranchesView />
    </div>
  );
}
