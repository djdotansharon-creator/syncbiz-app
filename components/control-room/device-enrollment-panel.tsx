"use client";

/**
 * DeviceEnrollmentPanel — Control Room: "Waiting for approval" (docs/DEVICE_ENROLLMENT_DESIGN.md §5.3; owner 2026-10-27). A new computer / phone that signs in to the account asks to be a Player
 * (it plays the music) or a Remote (it only controls); here the manager approves it in one press, or refuses it, and sees how much of the paid Player allocation is used.
 * Renders NOTHING unless the server has the feature available (env flag) — and for an admin only a small "turn on" card until the workspace switches it on. Texts: Hebrew / English.
 * Styles: `.cr-enr*` in components/control-room/device-enrollment.css.
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";
import "@/components/control-room/device-enrollment.css";
import { useLocale } from "@/lib/locale-context";
import { claimDeviceId } from "@/lib/device-id";
import { getEnrollmentDeviceId } from "@/lib/enrollment-device-id";
import { PlayerIcon, RemoteIcon } from "@/components/device-role-badge";

type Item = {
  id: string;
  durableDeviceId: string;
  status: string;
  platform: string;
  requestedRole: string;
  approvedRole: string | null;
  playerClass: string | null;
  label: string;
  note: string;
  requestedBranchId: string | null;
  approvedBranchIds: string[];
  branchNames: Record<string, string>;
  requestedAt: string;
  expiresAt: string;
  grandfathered: boolean;
  canDecide: boolean;
};
type Listing = {
  items: Item[];
  pendingCount: number;
  allocation: { used: number; max: number; remaining: number; full: boolean };
  config: { enabled: boolean; ttlDays: number };
  actor: { isAdmin: boolean; isManager: boolean };
};
type Settings = { available: boolean; enabled: boolean; ttlDays: number };

const HE = {
  title: "ממתינים לאישור",
  offTitle: "אישור מכשירים חדשים",
  offText: "כשזה דלוק, מחשב או טלפון חדש שנכנס לחשבון מבקש ממך אישור לפני שהוא מנגן או שולט. אתה מחליט אם הוא נגן או שלט רחוק.",
  offNote: "ההדלקה מאשרת אוטומטית את כל התחנות שכבר פועלות ואת המכשיר הזה, כך שדבר לא נעצר.",
  turnOn: "הדלקה",
  turnOff: "כיבוי",
  confirmOff: "לכבות? המכשירים יחזרו להתנהג כמו קודם.",
  allocation: "נגנים",
  of: "מתוך",
  none: "אין בקשות שממתינות.",
  approve: "אישור",
  approveRemote: "אישור כשלט רחוק",
  reject: "דחייה",
  revoke: "ביטול",
  devices: "מכשירים מאושרים",
  asks: "מבקש להיות",
  player: "נגן",
  remote: "שלט רחוק",
  browserPlayer: "נגן בדפדפן (מנגן כל עוד הלשונית פתוחה)",
  station: "תחנה",
  existing: "קיים מראש",
  thisDevice: "המכשיר הזה",
  ago: (m: number) => (m < 1 ? "הרגע" : m < 60 ? `לפני ${m} דקות` : m < 1440 ? `לפני ${Math.round(m / 60)} שעות` : `לפני ${Math.round(m / 1440)} ימים`),
  expires: (d: number) => (d <= 1 ? "פג היום" : `פג בעוד ${d} ימים`),
  expired: "פג תוקף",
  noScope: "בלי סניף — רק מנהל ראשי מאשר",
  unnamed: "מכשיר ללא שם",
  ttl: "ימים עד שבקשה פגה",
  errors: {
    allocation_full: "ההקצאה מלאה — אי אפשר לאשר עוד נגן. אפשר לאשר כשלט רחוק.",
    forbidden: "אין לך הרשאה לאשר את זה.",
    not_pending: "הבקשה כבר טופלה או שפג תוקפה.",
    enrollment_not_available: "האפשרות הזאת עדיין לא פעילה בשרת.",
    other: "משהו השתבש. נסו שוב.",
  } as Record<string, string>,
};
const EN = {
  title: "Waiting for approval",
  offTitle: "Approve new devices",
  offText: "When this is on, a new computer or phone that signs in to the account asks you before it plays or controls anything. You decide whether it is a Player or a Remote.",
  offNote: "Turning it on automatically approves every station that already runs and this device, so nothing stops.",
  turnOn: "Turn on",
  turnOff: "Turn off",
  confirmOff: "Turn it off? Devices go back to behaving as before.",
  allocation: "Players",
  of: "of",
  none: "No requests are waiting.",
  approve: "Approve",
  approveRemote: "Approve as Remote",
  reject: "Reject",
  revoke: "Revoke",
  devices: "Approved devices",
  asks: "Asks to be",
  player: "Player",
  remote: "Remote",
  browserPlayer: "Browser player (plays while its tab is open)",
  station: "Station",
  existing: "already there",
  thisDevice: "this device",
  ago: (m: number) => (m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`),
  expires: (d: number) => (d <= 1 ? "expires today" : `expires in ${d} days`),
  expired: "expired",
  noScope: "No branch — only the main admin can approve",
  unnamed: "Unnamed device",
  ttl: "Days until a request expires",
  errors: {
    allocation_full: "The allocation is full — another Player cannot be approved. You can approve it as a Remote.",
    forbidden: "You are not allowed to approve this.",
    not_pending: "The request was already handled or has expired.",
    enrollment_not_available: "This is not active on the server yet.",
    other: "Something went wrong. Try again.",
  } as Record<string, string>,
};

async function getJson<T>(url: string): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const r = await fetch(url, { cache: "no-store", credentials: "include" });
    return { ok: r.ok, status: r.status, data: r.ok ? ((await r.json()) as T) : null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error ?? "other" };
  } catch {
    return { ok: false, error: "other" };
  }
}

export function DeviceEnrollmentPanel(): ReactElement | null {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const [listing, setListing] = useState<Listing | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOn, setConfirmOn] = useState(false);

  const load = useCallback(async () => {
    const l = await getJson<Listing>("/api/control-room/enrollments");
    if (l.ok && l.data) {
      setListing(l.data);
      if (l.data.actor.isAdmin) {
        const s = await getJson<Settings>("/api/control-room/enrollment-settings");
        if (s.ok && s.data) setSettings(s.data);
      }
    } else {
      setListing(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const act = async (id: string, kind: "approve" | "approveRemote" | "reject" | "revoke", item?: Item) => {
    setBusy(id);
    setErr(null);
    let r: { ok: boolean; error?: string };
    if (kind === "approve" || kind === "approveRemote") {
      const role = kind === "approve" ? (item?.requestedRole === "PLAYER" ? "PLAYER" : "REMOTE") : "REMOTE";
      r = await postJson(`/api/control-room/enrollments/${id}/approve`, { role, branchIds: item?.requestedBranchId ? [item.requestedBranchId] : [] });
    } else {
      r = await postJson(`/api/control-room/enrollments/${id}/${kind}`, {});
    }
    if (!r.ok) setErr(t.errors[r.error ?? "other"] ?? t.errors.other!);
    setBusy(null);
    await load();
  };

  const switchOn = async () => {
    setBusy("settings");
    setErr(null);
    let ownId: string | undefined;
    try {
      ownId = await claimDeviceId();
    } catch {
      ownId = undefined;
    }
    const r = await postJson("/api/control-room/enrollment-settings", { enabled: true, ownDeviceId: ownId, ownDeviceLabel: he ? "המכשיר של המנהל" : "Admin's device" });
    if (!r.ok) setErr(t.errors[r.error ?? "other"] ?? t.errors.other!);
    setConfirmOn(false);
    setBusy(null);
    await load();
  };
  const switchOff = async () => {
    if (!window.confirm(t.confirmOff)) return;
    setBusy("settings");
    await postJson("/api/control-room/enrollment-settings", { enabled: false });
    setBusy(null);
    await load();
  };

  // not available on this server, or the viewer may not decide anything: no panel at all
  if (!listing) return null;
  if (!listing.config.enabled && !(listing.actor.isAdmin && settings?.available)) return null;

  const now = Date.now();
  const minutes = (iso: string) => Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
  const mine = typeof window === "undefined" ? null : getEnrollmentDeviceId();
  const roleName = (r: string) => (r === "PLAYER" ? t.player : t.remote);
  const scope = (it: Item) => {
    const ids = it.approvedBranchIds.length > 0 ? it.approvedBranchIds : it.requestedBranchId ? [it.requestedBranchId] : [];
    return ids.length > 0 ? ids.map((i) => it.branchNames[i] ?? i).join(", ") : "";
  };

  // switched off: a calm card that explains and offers to turn it on (admin only)
  if (!listing.config.enabled) {
    return (
      <section className="cr-enr" dir={he ? "rtl" : "ltr"}>
        <h3>{t.offTitle}</h3>
        <p>{t.offText}</p>
        {confirmOn ? <p className="cr-enr-note">{t.offNote}</p> : null}
        <div className="cr-enr-actions">
          {confirmOn ? (
            <>
              <button type="button" className="cr-enr-btn is-main" disabled={busy !== null} onClick={() => void switchOn()}>{t.turnOn}</button>
              <button type="button" className="cr-enr-btn" onClick={() => setConfirmOn(false)}>×</button>
            </>
          ) : (
            <button type="button" className="cr-enr-btn is-main" onClick={() => setConfirmOn(true)}>{t.turnOn}</button>
          )}
        </div>
        {err ? <p className="cr-enr-err" role="alert">{err}</p> : null}
      </section>
    );
  }

  const pending = listing.items.filter((i) => i.status === "pending");
  const approved = listing.items.filter((i) => i.status === "approved");
  const pct = listing.allocation.max > 0 ? Math.min(100, Math.round((listing.allocation.used / listing.allocation.max) * 100)) : 0;

  return (
    <section className="cr-enr" dir={he ? "rtl" : "ltr"}>
      <header className="cr-enr-head">
        <h3>
          {t.title}
          {pending.length > 0 ? <span className="cr-enr-badge">{pending.length}</span> : null}
        </h3>
        <div className="cr-enr-meter" title={`${t.allocation} ${listing.allocation.used} ${t.of} ${listing.allocation.max}`}>
          <span>
            {t.allocation} <b>{listing.allocation.used}</b> {t.of} <b>{listing.allocation.max}</b>
          </span>
          <i className="cr-enr-bar" data-full={listing.allocation.full ? "1" : undefined}>
            <u style={{ width: `${pct}%` }} />
          </i>
        </div>
      </header>

      {pending.length === 0 ? <p className="cr-enr-empty">{t.none}</p> : null}
      <ul className="cr-enr-list">
        {pending.map((it) => (
          <li key={it.id} className="cr-enr-item" data-role={it.requestedRole === "PLAYER" ? "player" : "remote"}>
            <span className="cr-enr-ic">{it.requestedRole === "PLAYER" ? <PlayerIcon /> : <RemoteIcon />}</span>
            <div className="cr-enr-txt">
              <b dir="auto">{it.label || t.unnamed}</b>
              <small>
                {t.asks} <em>{roleName(it.requestedRole)}</em>
                {it.requestedRole === "PLAYER" && it.playerClass === "browser" ? ` · ${t.browserPlayer}` : ""}
                {scope(it) ? ` · ${scope(it)}` : ""}
                {` · ${t.ago(minutes(it.requestedAt))} · ${daysLeft(it.expiresAt) > 0 ? t.expires(daysLeft(it.expiresAt)) : t.expired}`}
              </small>
              {it.note ? <small dir="auto" className="cr-enr-quote">“{it.note}”</small> : null}
              {!it.canDecide ? <small className="cr-enr-muted">{t.noScope}</small> : null}
            </div>
            <div className="cr-enr-actions">
              <button type="button" className="cr-enr-btn is-main" disabled={!it.canDecide || busy === it.id} onClick={() => void act(it.id, "approve", it)}>{t.approve}</button>
              {it.requestedRole === "PLAYER" ? (
                <button type="button" className="cr-enr-btn" disabled={!it.canDecide || busy === it.id} onClick={() => void act(it.id, "approveRemote", it)}>{t.approveRemote}</button>
              ) : null}
              <button type="button" className="cr-enr-btn" disabled={!it.canDecide || busy === it.id} onClick={() => void act(it.id, "reject")}>{t.reject}</button>
            </div>
          </li>
        ))}
      </ul>
      {err ? <p className="cr-enr-err" role="alert">{err}</p> : null}

      {approved.length > 0 ? (
        <details className="cr-enr-approved">
          <summary>
            {t.devices} <b>{approved.length}</b>
          </summary>
          <ul className="cr-enr-list">
            {approved.map((it) => (
              <li key={it.id} className="cr-enr-item is-quiet" data-role={it.approvedRole === "PLAYER" ? "player" : "remote"}>
                <span className="cr-enr-ic">{it.approvedRole === "PLAYER" ? <PlayerIcon /> : <RemoteIcon />}</span>
                <div className="cr-enr-txt">
                  <b dir="auto">{it.label || t.unnamed}</b>
                  <small>
                    {roleName(it.approvedRole ?? "REMOTE")}
                    {it.approvedRole === "PLAYER" ? ` · ${it.playerClass === "station" ? t.station : t.browserPlayer}` : ""}
                    {scope(it) ? ` · ${scope(it)}` : ""}
                    {it.grandfathered ? ` · ${t.existing}` : ""}
                    {it.durableDeviceId === mine ? ` · ${t.thisDevice}` : ""}
                  </small>
                </div>
                <div className="cr-enr-actions">
                  {/* never revoke the screen you are using — you would lock yourself out of this very panel */}
                  {it.durableDeviceId === mine ? null : (
                    <button type="button" className="cr-enr-btn" disabled={!it.canDecide || busy === it.id} onClick={() => void act(it.id, "revoke")}>{t.revoke}</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {listing.actor.isAdmin ? (
        <footer className="cr-enr-foot">
          <span>
            {t.ttl}: <b>{listing.config.ttlDays}</b>
          </span>
          <button type="button" className="cr-enr-link" disabled={busy !== null} onClick={() => void switchOff()}>{t.turnOff}</button>
        </footer>
      ) : null}
    </section>
  );
}
