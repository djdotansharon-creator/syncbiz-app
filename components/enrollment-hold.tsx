"use client";

/**
 * EnrollmentHold — "the player does not start until you are in the account, like Spotify" (owner 2026-10-28). When the server says enrollment is on for this workspace, NOTHING of the app is
 * mounted (no player, no library, no socket, no data requests) until this device is approved; a not-yet-approved device sees only the request screen. When a manager later revokes the device
 * (the 20-second re-check, see lib/use-enrollment-gate.ts), the app is taken away again. When enrollment is off (the env flag or the workspace switch), `enforced` is false and this renders its children untouched — the very
 * same tree as before. The desktop app's own screen is never held (stations use the activation code). Decided on the server in app/(app)/layout.tsx so a workspace with the feature off pays nothing.
 */

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LocaleProvider } from "@/lib/locale-context";
import { EnrollmentGateCard } from "@/components/enrollment-gate";
import { useEnrollmentGate } from "@/lib/use-enrollment-gate";

/** A computer approved as a REMOTE opens on the control screen (owner 2026-10-29: "a remote opens on the control room; a corner button goes to the live player"). Once per browser tab session, and only when it
 *  lands on the player's home — so the corner button / the browser back button are never fought. Nothing happens when enrollment is off (this component is only mounted while it is on). */
function RemoteHome() {
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

function EnforcedHold({ children }: { children: ReactNode }) {
  const gate = useEnrollmentGate();
  const st = gate.state;
  if (st && st.enforced && st.status === "approved" && st.role === "REMOTE") {
    return (
      <>
        <RemoteHome />
        {children}
      </>
    );
  }
  if (st && (!st.enforced || st.status === "approved")) return <>{children}</>;
  return (
    <LocaleProvider>
      <EnrollmentGateCard gate={gate} loading={st === null} />
    </LocaleProvider>
  );
}

export function EnrollmentHold({ enforced, children }: { enforced: boolean; children: ReactNode }) {
  if (!enforced) return <>{children}</>;
  return <EnforcedHold>{children}</EnforcedHold>;
}
