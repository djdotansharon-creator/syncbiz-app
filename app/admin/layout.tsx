import type { ReactNode } from "react";
import Link from "next/link";
import { requireSuperAdmin } from "@/lib/auth/guards";

/**
 * Root layout for the SyncBiz owner CRM (`/admin/**`).
 *
 * We gate here — at the layout — so every nested page, route handler
 * co-located under /admin, and server action inherits the same check.
 * Pages can still call `requireSuperAdmin()` themselves, but layout-level
 * gating means we can never accidentally ship an /admin page that forgot
 * to guard.
 *
 * Intentionally minimal chrome for Stage 0. The admin CRM gets a proper
 * navigation shell in Stage 5.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireSuperAdmin();
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-neutral-800 px-6 py-3 text-sm">
        <span className="font-medium">SyncBiz · Owner CRM</span>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-neutral-400">
          <Link href="/admin/platform" className="hover:text-white">Platform</Link>
          <Link href="/admin/platform/telemetry" className="hover:text-white">Playback telemetry</Link>
        </nav>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}

export const metadata = {
  title: "SyncBiz Admin",
  robots: { index: false, follow: false },
};
