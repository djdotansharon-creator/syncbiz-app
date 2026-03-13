import { redirect } from "next/navigation";

/** MVP: Redirect dashboard to library. */
export default function DashboardPage() {
  redirect("/library");
}
