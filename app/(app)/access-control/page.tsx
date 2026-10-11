/**
 * Real Access Control page.
 *
 * Renders the connected `AccessControlConsole`, which talks to /api/admin/users
 * (GET / POST / PATCH / DELETE) and /api/branches. The premium console design
 * is the single, canonical user-management UI for both the web app and the
 * Electron desktop wrapper (which loads the same Next.js page).
 */
import { AccessControlConsole } from "@/components/access-control-console";

export default function AccessControlPage() {
  return (
    // Management Mode: full screen, outside the player workspace rails — this page scrolls on its own (like Control Room)
    <div className="h-full overflow-y-auto p-4 sm:p-6">
      <AccessControlConsole />
    </div>
  );
}
