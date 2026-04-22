import { redirect } from "next/navigation";

/**
 * Legacy entry point — all old links to `/mobile` funnel into the new 4-tab shell at
 * `/mobile/home`. Do not add page-specific UI here; edit `app/(app)/mobile/home/page.tsx`.
 */
export default function MobileIndexPage() {
  redirect("/mobile/home");
}
