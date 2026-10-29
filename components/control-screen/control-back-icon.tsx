"use client";

/**
 * The way back to the control screen from the player — ONLY on a screen that is a REMOTE (owner 2026-10-30: "in the player I am connected to there must be no such button"). A computer that is the
 * PLAYER (its own music plays here) never shows it; its way to the control screen is the gear. Display-only: it reads the device context and changes nothing.
 */

import Link from "next/link";
import { useDevicePlayer } from "@/lib/device-player-context";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { ControlRoomIcon } from "@/components/control-screen/control-bar";
import { AnyPendingDot } from "@/components/control-screen/pending-dots";

export function ControlBackIcon() {
  const ctx = useDevicePlayer();
  const L = useMgmt();
  // the same test as the role badge: this screen is the player when it is MASTER (or the designated audio station)
  const isPlayer = !!ctx && (ctx.deviceMode === "MASTER" || ctx.isDesignatedAudioStation);
  if (isPlayer) return null;
  return (
    <Link href="/owner/control-room" title={L.t("nav.controlRoom")} aria-label={L.t("nav.controlRoom")} className="sb-ctl-back">
      <ControlRoomIcon size={22} />
      <AnyPendingDot />
    </Link>
  );
}
