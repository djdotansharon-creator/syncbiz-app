import { getSuperAdminOrNull } from "@/lib/auth/guards";

/**
 * Stage 0 placeholder landing page for the SyncBiz owner CRM.
 *
 * Does nothing except greet the platform owner. Stage 1 will replace the
 * body with a real dashboard (pending submissions count, recent reviews,
 * duplicate queue, etc.). The layout above already enforces the
 * `SUPER_ADMIN` guard; this just reads the user for the greeting.
 */
export default async function AdminHome() {
  const user = await getSuperAdminOrNull();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">hello admin</h1>
      <p className="text-sm text-neutral-400">
        Signed in as <span className="font-mono">{user?.email ?? "unknown"}</span>
      </p>
      <p className="text-sm text-neutral-500">
        Stage 0 scaffolding. Review queue and canonical-data tools land in Stage 1+.
      </p>
    </div>
  );
}
