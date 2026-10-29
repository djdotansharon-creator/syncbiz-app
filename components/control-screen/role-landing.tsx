"use client";

/**
 * A person whose ROLE opens the Control Room (owner 2026-10-30: "automatic entry by role") lands on the control screen when they open VONO in a browser — once per tab, and only from the player's
 * home, so the corner button and Back are never fought. The server (app/(app)/layout.tsx) mounts this only for such a person (roles on, a role with the Control Room switch, a browser — never a phone,
 * never the desktop app). Shares its once-per-tab flag with the Remote landing (components/enrollment-hold.tsx).
 */

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

export function RoleLanding() {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem("vono_remote_home")) return;
      window.sessionStorage.setItem("vono_remote_home", "1");
    } catch {
      return;
    }
    if (pathname === "/" || pathname === "/sources") router.replace("/owner/control-room");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the first landing
  }, []);
  return null;
}
