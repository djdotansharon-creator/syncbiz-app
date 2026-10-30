import { redirect } from "next/navigation";

/** owner 2026-10-31: the Owner tab moved into Settings — "Business" (workspace profile) and "Remote control". Old links land on the right tab. */
export default function OwnerPage() {
  redirect("/settings?tab=business");
}
