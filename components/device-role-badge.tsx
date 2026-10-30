"use client";

/**
 * DeviceRoleBadge — a small icon in the top bar that says what THIS screen is: the PLAYER (a speaker with sound waves — the music plays here) or a REMOTE (a remote control sending a signal —
 * it controls a player somewhere else), so a press on "play" that goes to another device is never a silent mystery (owner 2026-10-27: a browser that was only a remote looked broken).
 * An icon with its name beside it (owner 2026-10-27: "next to the icon I want text"), no frame or box and no hover tooltip (the site has none — owner 2026-10-26); the name is kept for screen readers (`aria-label`). The waves breathe slowly
 * (opacity only, off for people who asked their system for less motion). Display only: it reads the device context and changes nothing — no playback, no election, no socket.
 * Hidden while the screen is not connected to the branch. Sits in the outer top bar, never inside the player. Styles: `.sb-role-icon*` in app/globals.css.
 */

import type { ReactElement } from "react";
import { useDevicePlayer } from "@/lib/device-player-context";
import { useLocale } from "@/lib/locale-context";

const HE = {
  word: { player: "נגן", remote: "שלט רחוק" },
  player: "נגן — המוזיקה מנגנת במחשב הזה",
  remote: "שלט רחוק — המסך הזה שולט בנגן אחר, המוזיקה מנגנת שם ולא כאן",
  remoteAt: (name: string) => `שלט רחוק — המסך הזה שולט בנגן ${name}, המוזיקה מנגנת שם ולא כאן`,
};
const EN = {
  word: { player: "Player", remote: "Remote" },
  player: "Player — the music plays on this computer",
  remote: "Remote — this screen controls another player, the music plays there, not here",
  remoteAt: (name: string) => `Remote — this screen controls the player ${name}, the music plays there, not here`,
};

const SVG = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function PlayerIcon(): ReactElement {
  return (
    <svg {...SVG}>
      <path d="M4 9.6h3l4.4-3.7v12.2L7 14.4H4z" fill="currentColor" fillOpacity={0.22} />
      <path className="sb-role-wave sb-role-wave--1" d="M14.6 9.4a3.6 3.6 0 0 1 0 5.2" />
      <path className="sb-role-wave sb-role-wave--2" d="M17.3 6.9a7.2 7.2 0 0 1 0 10.2" />
    </svg>
  );
}

export function RemoteIcon(): ReactElement {
  return (
    <svg {...SVG}>
      <rect x="8.3" y="9" width="7.4" height="12" rx="3.2" fill="currentColor" fillOpacity={0.22} />
      <circle cx="12" cy="13" r="1.15" fill="currentColor" stroke="none" />
      <path d="M10.7 17.2h2.6" />
      <path className="sb-role-wave sb-role-wave--1" d="M9.4 6.4a3.8 3.8 0 0 1 5.2 0" />
      <path className="sb-role-wave sb-role-wave--2" d="M7 3.9a7.2 7.2 0 0 1 10 0" />
    </svg>
  );
}

export function DeviceRoleBadge({ onOpen }: { onOpen?: () => void } = {}): ReactElement | null {
  const ctx = useDevicePlayer();
  const { locale } = useLocale();
  if (!ctx || !ctx.isActive || !ctx.isBranchConnected) return null;
  const t = locale === "he" ? HE : EN;
  // the desktop app's own screen is a controller by design while the co-located station plays: it is still the PLAYER computer
  const isPlayer = ctx.deviceMode === "MASTER" || ctx.isDesignatedAudioStation;
  const label = isPlayer ? t.player : ctx.masterDeviceName ? t.remoteAt(ctx.masterDeviceName) : t.remote;
  const inner = (
    <>
      {isPlayer ? <PlayerIcon /> : <RemoteIcon />}
      <span className="sb-role-text text-[12.5px] font-semibold leading-none" aria-hidden>
        {isPlayer ? t.word.player : t.word.remote}
      </span>
    </>
  );
  // owner 2026-10-31: pressing the icon opens the Player / Remote details window (the menu row that used to open it is gone)
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className="sb-role-icon inline-flex h-8 items-center justify-center gap-1.5 px-1" data-role={isPlayer ? "player" : "remote"} aria-label={label} aria-haspopup="dialog">
        {inner}
      </button>
    );
  }
  return (
    <span className="sb-role-icon inline-flex h-8 items-center justify-center gap-1.5 px-1" data-role={isPlayer ? "player" : "remote"} role="status" aria-label={label}>
      {inner}
    </span>
  );
}
