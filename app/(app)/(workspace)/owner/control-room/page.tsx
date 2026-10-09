import { redirect } from "next/navigation";
import { AllBranchesView } from "@/components/control-room/all-branches-view";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

/** CONTROL ROOM — step 1: all branches in one place (read-only live view). Lives under /owner so the existing
 *  app-shell / device-socket rules for /owner apply unchanged. */
export default async function ControlRoomPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?from=/owner/control-room");
  return <AllBranchesView />;
}
