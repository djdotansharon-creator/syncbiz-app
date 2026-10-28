"use client";

/**
 * EnrollmentHold — "the player does not start until you are in the account, like Spotify" (owner 2026-10-28). When the server says enrollment is on for this workspace, NOTHING of the app is
 * mounted (no player, no library, no socket, no data requests) until this device is approved; a not-yet-approved device sees only the request screen. When a manager later revokes the device
 * (the 5-minute re-check), the app is taken away again. When enrollment is off (the env flag or the workspace switch), `enforced` is false and this renders its children untouched — the very
 * same tree as before. The desktop app's own screen is never held (stations use the activation code). Decided on the server in app/(app)/layout.tsx so a workspace with the feature off pays nothing.
 */

import type { ReactNode } from "react";
import { LocaleProvider } from "@/lib/locale-context";
import { EnrollmentGateCard } from "@/components/enrollment-gate";
import { useEnrollmentGate } from "@/lib/use-enrollment-gate";

function EnforcedHold({ children }: { children: ReactNode }) {
  const gate = useEnrollmentGate();
  const st = gate.state;
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
