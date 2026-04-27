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
    <div className="p-4 sm:p-6">
      <AccessControlConsole />
    </div>
  );
}
