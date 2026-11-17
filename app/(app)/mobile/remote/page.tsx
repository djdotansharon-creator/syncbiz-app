import { redirect } from "next/navigation";

/**
 * The old "Remote" tab (Controller / Player switch + one-device connection card) is gone: the phone is always a remote, and the Branches tab shows every branch
 * it can control. This route stays only so a saved link / the installed app's old shortcut still lands somewhere sensible.
 */
export default function MobileRemoteRedirect() {
  redirect("/mobile/home");
}
