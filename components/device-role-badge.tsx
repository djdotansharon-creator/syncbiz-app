"use client";

/**
 * DeviceRoleBadge — a small label in the top bar that says what THIS screen is: the PLAYER (the music plays here) or a REMOTE (it controls a player somewhere else), so a press on "play"
 * that goes to another device is never a silent mystery (owner 2026-10-27: a browser that was only a remote looked broken — "play" did nothing and nothing said why).
 * Display only: it reads the device context and changes nothing — no playback, no election, no socket. Hidden while the screen is not connected to the branch.
 * Sits in the outer top bar, never inside the player.
 */

import type { ReactElement } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { useLocale } from "@/lib/locale-context";

const HE = {
  player: "נגן",
  remote: "שלט רחוק",
  playerHint: "המוזיקה מנגנת במחשב הזה",
  remoteHint: "המסך הזה שולט בנגן אחר — המוזיקה מנגנת שם, לא כאן",
  remoteAt: (name: string) => `המסך הזה שולט בנגן ${name} — המוזיקה מנגנת שם, לא כאן`,
};
const EN = {
  player: "Player",
  remote: "Remote",
  playerHint: "The music plays on this computer",
  remoteHint: "This screen controls another player — the music plays there, not here",
  remoteAt: (name: string) => `This screen controls the player ${name} — the music plays there, not here`,
};

export function DeviceRoleBadge(): ReactElement | null {
  const ctx = useDevicePlayer();
  const { locale } = useLocale();
  if (!ctx || !ctx.isActive || !ctx.isBranchConnected) return null;
  const t = locale === "he" ? HE : EN;
  // the desktop app's own screen is a controller by design while the co-located station plays: it is still the PLAYER computer
  const isPlayer = ctx.deviceMode === "MASTER" || ctx.isDesignatedAudioStation;
  const hint = isPlayer ? t.playerHint : ctx.masterDeviceName ? t.remoteAt(ctx.masterDeviceName) : t.remoteHint;
  return (
    <span
      className="sb-role-badge inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium leading-none text-[#d1d1d6]"
      style={{ background: "rgba(255,255,255,0.07)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
      data-role={isPlayer ? "player" : "remote"}
      title={hint}
      role="status"
      aria-label={hint}
    >
      <i aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: isPlayer ? "#30d158" : "#7db8ff" }} />
      {isPlayer ? t.player : t.remote}
    </span>
  );
}
