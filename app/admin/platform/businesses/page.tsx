import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { BusinessesHub } from "@/components/admin/businesses-hub";

export const dynamic = "force-dynamic";

/**
 * Platform → Businesses (owner 2026-11-10): every business as a square, its own page with tabs, and the PRIVATE music
 * banks opened per business. The layout already enforces SUPER_ADMIN; re-checked here for defense-in-depth.
 */
export default async function AdminBusinessesPage() {
  await requireSuperAdmin();
  return (
    <div className="space-y-5">
      <Link href="/admin/platform" className="text-sm text-neutral-400 hover:text-white">← Platform</Link>
      <BusinessesHub />
    </div>
  );
}
