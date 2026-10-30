"use client";

/**
 * Hides what only makes sense on the PLAYER's own computer when this screen is an approved REMOTE (owner 2026-10-31: "settings for a remote, not for the player — this is mine, not the player's"): the MASTER / CONTROL
 * switch, mix / crossfade, VONO Protection and the local library. Decided from the device's approved role (lib/use-approved-role.ts); a business that has not turned device approval on sees everything as before.
 */

import type { ReactNode } from "react";
import { useApprovedRole } from "@/lib/use-approved-role";

export function PlayerDeviceOnly({ children }: { children: ReactNode }) {
  return useApprovedRole() === "REMOTE" ? null : <>{children}</>;
}
