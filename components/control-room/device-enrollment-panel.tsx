"use client";

/**
 * Device approval in the Control Room (docs/DEVICE_ENROLLMENT_DESIGN.md §5.3; owner 2026-10-27 / 2026-10-28). A new computer / phone that signs in to the account asks to be a Player (plays the music) or a Remote
 * (only controls) — see components/enrollment-gate.tsx. Where the manager sees it, as the owner asked: the FIRST tile of the branch list is "New requests" (a plus, branch-sized; a red circle with the number); opening it
 * shows every request grouped by branch with the person's details and Approve / Reject; a branch name opens that branch (the map pins it, its screen lists its devices — `BranchDevices` below).
 * Renders nothing unless the server has the feature on. Texts: Hebrew / English. Styles: `.cr-enr*` in components/control-room/device-enrollment.css.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import "@/components/control-room/device-enrollment.css";
import { useLocale } from "@/lib/locale-context";
import { claimDeviceId } from "@/lib/device-id";
import { getEnrollmentDeviceId } from "@/lib/enrollment-device-id";
import { PlayerIcon, RemoteIcon } from "@/components/device-role-badge";
import { InfoIcon } from "@/components/info-icon";
import { ENROLLMENT_CHANGED_EVENT, useEnrollmentSummary } from "@/lib/use-enrollment-summary";

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
  requestedBranchName: string;
  requestedBranchAddress: string;
  requestedBrandName: string;
  requestedByEmail: string;
  requesterFirstName: string;
  requesterLastName: string;
  requesterPhone: string;
  requesterEmail: string;
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

const HE = {
  title: "בקשות חדשות",
  tile: "בקשות חדשות",
  tileNone: "אין בקשות שממתינות",
  tileSome: (n: number) => (n === 1 ? "בקשה אחת ממתינה" : `${n} בקשות ממתינות`),
  tileOff: "אישור מכשירים חדשים — כבוי",
  switchLabel: "אישור מכשירים חדשים",
  infoLabel: "הסבר",
  info: (d: number) => `כשזה דלוק, מחשב או טלפון חדש שנכנס לחשבון מבקש אישור לפני שהוא מנגן או שולט. התחנות שכבר פועלות והמחשב הזה מאושרים אוטומטית; כל מכשיר אחר יבקש. בקשה שלא טופלה פגה אחרי ${d} ימים. כשזה כבוי, הכול כמו קודם.`,
  back: "חזרה לסניפים",
  allocation: "נגנים",
  of: "מתוך",
  none: "אין בקשות שממתינות.",
  approve: "אישור",
  approveRemote: "אישור כשלט רחוק",
  reject: "דחייה",
  revoke: "ביטול",
  devices: "מכשירים מאושרים",
  branchDevices: "מכשירים בסניף",
  noDevices: "אין עדיין נגנים או שלטים מאושרים בסניף הזה.",
  waitingHere: "ממתינים לאישור",
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
  newBranch: (n: string) => `סניף חדש: ״${n}״`,
  newBranchGroup: "סניף שעוד לא קיים",
  chooseBranch: "בחרו סניף לאישור",
  chooseBranchHint: "הסניף שהוקלד עוד לא קיים. בחרו סניף קיים (או פתחו אותו קודם עם ״הוספת סניף״).",
  openBranch: "פתיחת הסניף",
  ttl: "ימים עד שבקשה פגה",
  allBranches: "כל הסניפים",
  address: "כתובת",
  brand: "מותג",
  fromAccount: "מהחשבון",
  ownerDevice: "המחשב של הבעלים",
  errors: {
    allocation_full: "ההקצאה מלאה — אי אפשר לאשר עוד נגן. אפשר לאשר כשלט רחוק.",
    player_needs_exactly_one_branch: "נגן שייך לסניף אחד — בחרו סניף.",
    branch_not_found: "הסניף לא נמצא.",
    forbidden: "אין לך הרשאה לאשר את זה.",
    not_pending: "הבקשה כבר טופלה או שפג תוקפה.",
    enrollment_not_available: "האפשרות הזאת עדיין לא פעילה בשרת.",
    other: "משהו השתבש. נסו שוב.",
  } as Record<string, string>,
};
const EN: typeof HE = {
  title: "New requests",
  tile: "New requests",
  tileNone: "Nothing is waiting",
  tileSome: (n: number) => (n === 1 ? "1 request waiting" : `${n} requests waiting`),
  tileOff: "Approving new devices — off",
  switchLabel: "Approve new devices",
  infoLabel: "Explain",
  info: (d: number) => `When this is on, a new computer or phone that signs in to the account asks for approval before it plays or controls anything. The stations that already run and this computer are approved automatically; any other device asks. An unhandled request expires after ${d} days. When it is off, everything is as before.`,
  back: "Back to branches",
  allocation: "Players",
  of: "of",
  none: "No requests are waiting.",
  approve: "Approve",
  approveRemote: "Approve as Remote",
  reject: "Reject",
  revoke: "Revoke",
  devices: "Approved devices",
  branchDevices: "Devices in this branch",
  noDevices: "No approved Players or Remotes in this branch yet.",
  waitingHere: "Waiting for approval",
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
  newBranch: (n: string) => `New branch: “${n}”`,
  newBranchGroup: "A branch that does not exist yet",
  chooseBranch: "Choose a branch to approve",
  chooseBranchHint: "The typed branch does not exist yet. Choose an existing branch (or create it first with “Add branch”).",
  openBranch: "Open the branch",
  ttl: "Days until a request expires",
  allBranches: "All branches",
  address: "Address",
  brand: "Brand",
  fromAccount: "From the account",
  ownerDevice: "The owner's computer",
  errors: {
    allocation_full: "The allocation is full — another Player cannot be approved. You can approve it as a Remote.",
    player_needs_exactly_one_branch: "A Player belongs to one branch — choose a branch.",
    branch_not_found: "The branch was not found.",
    forbidden: "You are not allowed to approve this.",
    not_pending: "The request was already handled or has expired.",
    enrollment_not_available: "This is not active on the server yet.",
    other: "Something went wrong. Try again.",
  },
};
type Dict = typeof HE;

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

/** the data and the actions behind the panel AND the branch screen's device list (one place, so both behave the same) */
function useEnrollmentData() {
  const { locale } = useLocale();
  const he = locale === "he";
  const t: Dict = he ? HE : EN;
  const [listing, setListing] = useState<Listing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // a request that typed a branch name which does not exist yet: the approver picks the real branch (the list is read only when such a request is waiting)
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const l = await getJson<Listing>("/api/control-room/enrollments");
    if (l.ok && l.data) {
      setListing(l.data);
    } else {
      setListing(null);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const needsBranchList = !!listing?.items.some((i) => i.status === "pending" && !i.requestedBranchId && i.canDecide);
  useEffect(() => {
    if (!needsBranchList || branches.length > 0) return;
    void getJson<Array<{ id?: unknown; name?: unknown }>>("/api/branches").then((r) => {
      if (r.ok && Array.isArray(r.data)) setBranches(r.data.filter((b) => typeof b.id === "string").map((b) => ({ id: String(b.id), name: typeof b.name === "string" ? b.name : String(b.id) })));
    });
  }, [needsBranchList, branches.length]);

  const changed = async () => {
    await load();
    window.dispatchEvent(new Event(ENROLLMENT_CHANGED_EVENT)); // the red circle and the tile update at once
  };

  const act = async (id: string, kind: "approve" | "approveRemote" | "reject" | "revoke", item?: Item) => {
    setBusy(id);
    setErr(null);
    let r: { ok: boolean; error?: string };
    if (kind === "approve" || kind === "approveRemote") {
      const role = kind === "approve" ? (item?.requestedRole === "PLAYER" ? "PLAYER" : "REMOTE") : "REMOTE";
      const branchId = item?.requestedBranchId ?? chosen[id] ?? "";
      r = await postJson(`/api/control-room/enrollments/${id}/approve`, { role, branchIds: branchId ? [branchId] : [] });
    } else {
      r = await postJson(`/api/control-room/enrollments/${id}/${kind}`, {});
    }
    if (!r.ok) setErr(t.errors[r.error ?? "other"] ?? t.errors.other!);
    setBusy(null);
    await changed();
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
    setBusy(null);
    await changed();
  };
  const switchOff = async () => {
    setBusy("settings");
    await postJson("/api/control-room/enrollment-settings", { enabled: false });
    setBusy(null);
    await changed();
  };

  return { he, t, listing, busy, err, branches, chosen, setChosen, act, switchOn, switchOff };
}
type Data = ReturnType<typeof useEnrollmentData>;

function who(it: Item, t: Dict): string {
  return `${it.requesterFirstName} ${it.requesterLastName}`.trim() || it.requestedByEmail || it.label || t.unnamed;
}

/** one request waiting for a decision: who, how to reach them, what they ask for, and the buttons */
function RequestRow({ it, d }: { it: Item; d: Data }): ReactElement {
  const { t, busy, chosen, setChosen, branches, act } = d;
  const now = Date.now();
  const minutes = Math.max(0, Math.round((now - new Date(it.requestedAt).getTime()) / 60000));
  const daysLeft = Math.max(0, Math.ceil((new Date(it.expiresAt).getTime() - now) / 86_400_000));
  const needsPick = !it.requestedBranchId;
  const blocked = !it.canDecide || busy === it.id || (needsPick && !chosen[it.id]);
  return (
    <li className="cr-enr-item" data-role={it.requestedRole === "PLAYER" ? "player" : "remote"}>
      <span className="cr-enr-ic">{it.requestedRole === "PLAYER" ? <PlayerIcon /> : <RemoteIcon />}</span>
      <div className="cr-enr-txt">
        <b><bdi>{who(it, t)}</bdi></b>
        {it.requesterPhone || it.requesterEmail ? (
          <small className="cr-enr-contact">
            {it.requesterPhone ? <a href={`tel:${it.requesterPhone.replace(/[^\d+]/g, "")}`} dir="ltr">{it.requesterPhone}</a> : null}
            {it.requesterEmail ? <a href={`mailto:${it.requesterEmail}`} dir="ltr">{it.requesterEmail}</a> : null}
          </small>
        ) : it.requestedByEmail && who(it, t) !== it.requestedByEmail ? (
          <small className="cr-enr-contact">
            {t.fromAccount} <a href={`mailto:${it.requestedByEmail}`} dir="ltr">{it.requestedByEmail}</a>
          </small>
        ) : null}
        {it.requestedBranchAddress || it.requestedBrandName ? (
          <small dir="auto">
            {it.requestedBranchAddress ? `${t.address}: ${it.requestedBranchAddress}` : ""}
            {it.requestedBranchAddress && it.requestedBrandName ? " · " : ""}
            {it.requestedBrandName ? `${t.brand}: ${it.requestedBrandName}` : ""}
          </small>
        ) : null}
        <small>
          {t.asks} <em>{it.requestedRole === "PLAYER" ? t.player : t.remote}</em>
          {it.requestedRole === "PLAYER" && it.playerClass === "browser" ? ` · ${t.browserPlayer}` : ""}
          {it.label ? ` · ${it.label}` : ""}
          {` · ${t.ago(minutes)} · ${daysLeft > 0 ? t.expires(daysLeft) : t.expired}`}
        </small>
        {it.note ? <small dir="auto" className="cr-enr-quote">“{it.note}”</small> : null}
        {!it.canDecide ? <small className="cr-enr-muted">{t.noScope}</small> : null}
        {needsPick && it.canDecide ? (
          <label className="cr-enr-pick">
            <span>{t.chooseBranch}</span>
            <select value={chosen[it.id] ?? ""} onChange={(e) => setChosen((c) => ({ ...c, [it.id]: e.target.value }))}>
              <option value="">—</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="cr-enr-actions">
        <button type="button" className="cr-enr-btn is-main" disabled={blocked} onClick={() => void act(it.id, "approve", it)}>{t.approve}</button>
        {it.requestedRole === "PLAYER" ? (
          <button type="button" className="cr-enr-btn" disabled={blocked} onClick={() => void act(it.id, "approveRemote", it)}>{t.approveRemote}</button>
        ) : null}
        <button type="button" className="cr-enr-btn" disabled={!it.canDecide || busy === it.id} onClick={() => void act(it.id, "reject")}>{t.reject}</button>
      </div>
    </li>
  );
}

/** one approved device (quiet): what it is, where, and — except the screen in use — Revoke */
function ApprovedRow({ it, d }: { it: Item; d: Data }): ReactElement {
  const { t, busy, act } = d;
  const mine = typeof window === "undefined" ? null : getEnrollmentDeviceId();
  const isOwner = it.playerClass === "owner";
  const scope = it.approvedBranchIds.length > 0 ? it.approvedBranchIds.map((i) => it.branchNames[i] ?? i).join(", ") : t.allBranches;
  return (
    <li className="cr-enr-item is-quiet" data-role={it.approvedRole === "PLAYER" ? "player" : "remote"}>
      <span className="cr-enr-ic">{it.approvedRole === "PLAYER" ? <PlayerIcon /> : <RemoteIcon />}</span>
      <div className="cr-enr-txt">
        <b><bdi>{who(it, t)}</bdi></b>
        <small>
          {isOwner ? t.ownerDevice : it.approvedRole === "PLAYER" ? t.player : t.remote}
          {!isOwner && it.approvedRole === "PLAYER" ? ` · ${it.playerClass === "station" ? t.station : t.browserPlayer}` : ""}
          {scope ? ` · ${scope}` : ""}
          {it.label && it.label !== who(it, t) ? ` · ${it.label}` : ""}
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
  );
}

function Meter({ d }: { d: Data }): ReactElement | null {
  const { t, listing } = d;
  if (!listing || !listing.config.enabled) return null;
  const pct = listing.allocation.max > 0 ? Math.min(100, Math.round((listing.allocation.used / listing.allocation.max) * 100)) : 0;
  return (
    <div className="cr-enr-meter" title={`${t.allocation} ${listing.allocation.used} ${t.of} ${listing.allocation.max}`}>
      <span>
        {t.allocation} <b>{listing.allocation.used}</b> {t.of} <b>{listing.allocation.max}</b>
      </span>
      <i className="cr-enr-bar" data-full={listing.allocation.full ? "1" : undefined}>
        <u style={{ width: `${pct}%` }} />
      </i>
    </div>
  );
}

/** device approval on / off (admin only) — just a switch; the explanation is behind a small "i" (owner 2026-10-28: "a simple switch and that's it") */
function SwitchControl({ d }: { d: Data }): ReactElement | null {
  const { t, listing, busy, switchOn, switchOff } = d;
  const [info, setInfo] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!info) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setInfo(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setInfo(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [info]);
  if (!listing || !listing.actor.isAdmin) return null;
  const on = listing.config.enabled;
  return (
    <div ref={rootRef} className="cr-enr-switchwrap">
      <button type="button" role="switch" aria-checked={on} aria-label={t.switchLabel} className="cr-switch" data-on={on ? "1" : undefined} disabled={busy !== null} onClick={() => void (on ? switchOff() : switchOn())}>
        <i aria-hidden />
      </button>
      <button type="button" className="cr-enr-i" aria-label={t.infoLabel} aria-expanded={info} onClick={() => setInfo((v) => !v)}><InfoIcon size={22} /></button>
      {info ? <p className="cr-enr-infopop" role="note">{t.info(listing.config.ttlDays)}</p> : null}
    </div>
  );
}

/** the "New requests" screen: opens in the list's place (like a branch does); requests grouped by branch, a branch name opens that branch on the map */
export function EnrollmentRequestsPanel({ onBack, onOpenBranch }: { onBack: () => void; onOpenBranch: (branchId: string) => void }): ReactElement {
  const d = useEnrollmentData();
  const { he, t, listing, err } = d;
  const dir = he ? "rtl" : "ltr";

  const head = (
    <header className="cr-bp-head">
      <button type="button" onClick={onBack} className="cr-bp-icon cr-bp-back" aria-label={t.back} title={t.back}>
        <svg className="h-[18px] w-[18px] rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <span className="cr-enr-plus" aria-hidden>
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
      </span>
      <div className="cr-bp-name" dir={dir}>
        <h2 dir="auto">{t.title}</h2>
        {listing && listing.config.enabled ? <p>{listing.pendingCount > 0 ? t.tileSome(listing.pendingCount) : t.tileNone}</p> : null}
      </div>
      <span className="flex-1" />
      <Meter d={d} />
      <SwitchControl d={d} />
    </header>
  );

  if (!listing) {
    return (
      <div className="cr-bp cr-enrp" dir={dir}>
        {head}
      </div>
    );
  }

  // switched off: just the header with the switch (the explanation is behind the "i")
  if (!listing.config.enabled) {
    return (
      <div className="cr-bp cr-enrp" dir={dir}>
        {head}
        {err ? <p className="cr-enr-err" role="alert">{err}</p> : null}
      </div>
    );
  }

  const pending = listing.items.filter((i) => i.status === "pending");
  // group the waiting requests by branch: a real branch (its name opens the branch), or a typed name for a branch that does not exist yet
  const groups: Array<{ key: string; branchId: string | null; name: string; items: Item[] }> = [];
  for (const it of pending) {
    const key = it.requestedBranchId ?? `new:${it.requestedBranchName.trim().toLowerCase()}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, branchId: it.requestedBranchId, name: it.requestedBranchId ? it.branchNames[it.requestedBranchId] ?? it.requestedBranchId : it.requestedBranchName ? t.newBranch(it.requestedBranchName) : t.newBranchGroup, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }

  return (
    <div className="cr-bp cr-enrp" dir={dir}>
      {head}
      {pending.length === 0 ? <p className="cr-enr-empty">{t.none}</p> : null}
      {groups.map((g) => (
        <section key={g.key} className="cr-enr-group">
          <header className="cr-enr-ghead">
            {g.branchId ? (
              <button type="button" className="cr-enr-gname" onClick={() => onOpenBranch(g.branchId!)} title={t.openBranch}>
                <bdi>{g.name}</bdi>
                <svg className="rtl:rotate-180" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
              </button>
            ) : (
              <span className="cr-enr-gname is-new"><bdi>{g.name}</bdi></span>
            )}
            <span className="cr-enr-badge">{g.items.length}</span>
          </header>
          {!g.branchId ? <p className="cr-enr-hint">{t.chooseBranchHint}</p> : null}
          <ul className="cr-enr-list">
            {g.items.map((it) => (
              <RequestRow key={it.id} it={it} d={d} />
            ))}
          </ul>
        </section>
      ))}
      {err ? <p className="cr-enr-err" role="alert">{err}</p> : null}

    </div>
  );
}

/** inside ONE branch's screen: the Players / Remotes approved for it and the requests waiting for it (renders nothing while the feature is off) */
export function BranchDevices({ branchId }: { branchId: string }): ReactElement | null {
  const d = useEnrollmentData();
  const { t, listing, err } = d;
  if (!listing || !listing.config.enabled) return null;
  const forBranch = (it: Item) => (it.status === "approved" ? it.approvedBranchIds : it.requestedBranchId ? [it.requestedBranchId] : []).includes(branchId);
  const pending = listing.items.filter((i) => i.status === "pending" && forBranch(i));
  const approved = listing.items.filter((i) => i.status === "approved" && forBranch(i));
  return (
    <section className="cr-bp-sec cr-enr-branch">
      <h3 className="cr-bp-title">{t.branchDevices}</h3>
      {pending.length === 0 && approved.length === 0 ? <p className="cr-enr-empty">{t.noDevices}</p> : null}
      {pending.length > 0 ? (
        <>
          <p className="cr-enr-sublabel">{t.waitingHere} <b>{pending.length}</b></p>
          <ul className="cr-enr-list">
            {pending.map((it) => (
              <RequestRow key={it.id} it={it} d={d} />
            ))}
          </ul>
        </>
      ) : null}
      {approved.length > 0 ? (
        <ul className="cr-enr-list">
          {approved.map((it) => (
            <ApprovedRow key={it.id} it={it} d={d} />
          ))}
        </ul>
      ) : null}
      {err ? <p className="cr-enr-err" role="alert">{err}</p> : null}
    </section>
  );
}

/** the first tile of the branch list — branch-sized, a plus, the red count; shown to someone who may decide requests (or to the main admin while the feature is still off, to turn it on) */
export function EnrollmentTile({ selected, onOpen }: { selected: boolean; onOpen: () => void }): ReactElement | null {
  const { locale } = useLocale();
  const t: Dict = locale === "he" ? HE : EN;
  const s = useEnrollmentSummary();
  const visible = s.loaded && s.available && ((s.enabled && s.canDecide) || (!s.enabled && s.isAdmin));
  if (!visible) return null;
  return (
    <li data-requests-tile className={`cr-row cr-row--requests${selected ? " is-selected" : ""}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} aria-label={t.tile}>
      <span className="cr-row-logo cr-enr-tile-logo" aria-hidden>
        <svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        {s.count > 0 ? <span className="cr-enr-tile-dot">{s.count > 9 ? "9+" : s.count}</span> : null}
      </span>
      <span className="cr-row-main">
        <span className="cr-row-name">{t.tile}</span>
        <span className="cr-row-sub">
          <span>{!s.enabled ? t.tileOff : s.count > 0 ? t.tileSome(s.count) : t.tileNone}</span>
        </span>
      </span>
    </li>
  );
}
