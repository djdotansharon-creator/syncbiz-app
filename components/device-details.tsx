"use client";

/**
 * Device details (owner 2026-10-28): "which branch am I, what is this computer, who does it control?" — a row in the gear menu ("Player / Remote details") that opens one small panel:
 * the role of THIS screen (Player · Remote · the owner's computer), the branch, what it plays / controls, the device, the approval and the account. Display-only: it reads what the app already knows
 * (the device context, the branch list, the approval status call, the account) and changes nothing — no socket, no playback, no election.
 */

import { useEffect, useState, type ReactElement } from "react";
import { useLocale } from "@/lib/locale-context";
import { useDevicePlayer } from "@/lib/device-player-context";
import { useStationBranchId } from "@/lib/station-branch";
import { detectDeviceLabel, getEnrollmentDeviceId } from "@/lib/enrollment-device-id";
import { PlayerIcon, RemoteIcon } from "@/components/device-role-badge";
import { InfoIcon } from "@/components/info-icon";

type Approval = { enforced: false } | { enforced: true; status: string; role?: "PLAYER" | "REMOTE"; playerClass?: string | null; branchIds?: string[] };
type Me = { email?: string | null; accountName?: string | null; name?: string | null };

const HE = {
  menuPlayer: "פרטי נגן",
  menuRemote: "פרטי שלט רחוק",
  title: "פרטי המכשיר הזה",
  player: "נגן",
  remote: "שלט רחוק",
  owner: "המחשב של הבעלים",
  notConnected: "לא מחובר לסניף",
  connected: "מחובר",
  branch: "סניף",
  allBranches: "כל הסניפים",
  defaultBranch: "הסניף שלך (ברירת מחדל)",
  plays: "מנגן כאן",
  thisComputer: "במחשב הזה",
  controls: "שולט בנגן",
  controlsNone: "אין כרגע נגן מחובר בסניף",
  device: "מכשיר",
  desktop: "אפליקציית VONO",
  approval: "אישור",
  approvalOff: "אישור מכשירים כבוי",
  approvedPlayer: "מאושר כנגן",
  approvedRemote: "מאושר כשלט רחוק",
  approvedOwner: "מאושר כמחשב של הבעלים",
  approvalOther: "לא מאושר עדיין",
  account: "חשבון",
  close: "סגירה",
};
const EN: typeof HE = {
  menuPlayer: "Player details",
  menuRemote: "Remote details",
  title: "This device",
  player: "Player",
  remote: "Remote",
  owner: "The owner's computer",
  notConnected: "Not connected to a branch",
  connected: "Connected",
  branch: "Branch",
  allBranches: "All branches",
  defaultBranch: "Your own branch (default)",
  plays: "Plays here",
  thisComputer: "On this computer",
  controls: "Controls the player",
  controlsNone: "No player is connected in the branch right now",
  device: "Device",
  desktop: "VONO app",
  approval: "Approval",
  approvalOff: "Device approval is off",
  approvedPlayer: "Approved as a Player",
  approvedRemote: "Approved as a Remote",
  approvedOwner: "Approved as the owner's computer",
  approvalOther: "Not approved yet",
  account: "Account",
  close: "Close",
};

/** the gear-menu row — the very first one: a circle with an "i", "Player details" for a player and "Remote details" for a remote. It only asks the shell to open the panel (the menu closes itself, so the panel lives in the shell) */
export function DeviceDetailsMenuRow({ onOpen }: { onOpen: () => void }): ReactElement {
  const { locale } = useLocale();
  const t = locale === "he" ? HE : EN;
  const ctx = useDevicePlayer();
  const isPlayer = !!ctx && (ctx.deviceMode === "MASTER" || ctx.isDesignatedAudioStation);
  return (
    <button type="button" className="sb-kiosk-menu-row sb-devdet-row" onClick={onOpen}>
      <span className="sb-devdet-i" aria-hidden><InfoIcon size={20} /></span>
      <span>{isPlayer ? t.menuPlayer : t.menuRemote}</span>
    </button>
  );
}

export function DeviceDetailsModal({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const ctx = useDevicePlayer();
  const branchId = useStationBranchId();
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!open) return;
    let off = false;
    void fetch("/api/branches", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id?: unknown; name?: unknown }>) => {
        if (!off && Array.isArray(rows)) setBranches(rows.filter((b) => typeof b.id === "string").map((b) => ({ id: String(b.id), name: typeof b.name === "string" ? b.name : String(b.id) })));
      })
      .catch(() => undefined);
    void fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Me | null) => { if (!off) setMe(j); })
      .catch(() => undefined);
    const id = getEnrollmentDeviceId();
    if (id && !(window as Window & { syncbizDesktop?: unknown }).syncbizDesktop) {
      void fetch("/api/devices/enrollment/status", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ durableDeviceId: id }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Approval | null) => { if (!off && j) setApproval(j); })
        .catch(() => undefined);
    } else {
      setApproval({ enforced: false });
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { off = true; document.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!open) return null;

  const nameOf = (id: string): string => (id === "default" ? t.defaultBranch : branches.find((b) => b.id === id)?.name ?? id);
  const connected = !!ctx && ctx.isActive && ctx.isBranchConnected;
  const isOwnerComputer = !!approval && approval.enforced && approval.status === "approved" && approval.playerClass === "owner";
  const isPlayer = !!ctx && (ctx.deviceMode === "MASTER" || ctx.isDesignatedAudioStation);
  // owner 2026-10-31: a Remote — the owner's own computer included — shows the REMOTE icon and its own details plus who it controls, never the player's card
  const roleName = isPlayer ? t.player : t.remote;
  const approvedBranches = approval && approval.enforced && approval.status === "approved" ? approval.branchIds ?? [] : [];
  const branchText = isPlayer && isOwnerComputer
    ? `${t.allBranches}${branchId ? ` · ${nameOf(branchId)}` : ""}`
    : !isPlayer
      ? branchId
        ? nameOf(branchId)
        : "—"
      : approvedBranches.length > 0
        ? approvedBranches.map(nameOf).join(", ")
        : branchId
          ? nameOf(branchId)
          : "—";
  const isDesktop = typeof window !== "undefined" && !!(window as Window & { syncbizDesktop?: unknown }).syncbizDesktop;
  const deviceText = `${isDesktop ? t.desktop : detectDeviceLabel()}${ctx?.deviceId ? ` · ${ctx.deviceId.slice(-6)}` : ""}`;
  const approvalText = !approval
    ? "…"
    : !approval.enforced
      ? t.approvalOff
      : approval.status === "approved"
        ? isOwnerComputer
          ? t.approvedOwner
          : approval.role === "PLAYER"
            ? t.approvedPlayer
            : t.approvedRemote
        : t.approvalOther;
  const controlling = ctx && ctx.masterDeviceLabel ? `${ctx.masterDeviceLabel}${ctx.masterDeviceName ? ` · ${ctx.masterDeviceName}` : ""}` : t.controlsNone;
  const account = [me?.accountName, me?.email].filter(Boolean).join(" · ");

  return (
    <div className="sb-devdet" dir={he ? "rtl" : "ltr"} role="dialog" aria-modal="true" aria-label={t.title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sb-devdet-panel">
        <button type="button" className="sb-devdet-x" onClick={onClose} aria-label={t.close}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
        <div className="sb-devdet-hero" data-role={isPlayer ? "player" : "remote"}>
          <span className="ic">{isPlayer ? <PlayerIcon /> : <RemoteIcon />}</span>
          <b>{roleName}</b>
          <small>{connected ? t.connected : t.notConnected}</small>
        </div>
        <dl className="sb-devdet-list">
          <div><dt>{t.branch}</dt><dd dir="auto">{branchText}</dd></div>
          <div><dt>{isPlayer ? t.plays : t.controls}</dt><dd dir="auto">{isPlayer ? t.thisComputer : controlling}</dd></div>
          <div><dt>{t.device}</dt><dd dir="auto">{deviceText}</dd></div>
          <div><dt>{t.approval}</dt><dd>{approvalText}</dd></div>
          {account ? <div><dt>{t.account}</dt><dd dir="auto">{account}</dd></div> : null}
        </dl>
      </div>
    </div>
  );
}
