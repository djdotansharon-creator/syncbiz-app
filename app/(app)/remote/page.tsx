import { redirect } from "next/navigation";

/**
 * The Remote Controller is not part of this interface (owner 2026-10-22: "no option at all to reach it"). The old page is kept in
 * design/backups/remote-page.tsx.pre-remove-2026-10-22 — anyone who still opens /remote lands in the library.
 */
export default function RemoteControllerPage(): never {
  redirect("/sources");
}
