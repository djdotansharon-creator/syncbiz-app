"use client";

/**
 * EnrollmentGateCard — what a NOT-yet-approved device sees (docs/DEVICE_ENROLLMENT_DESIGN.md §5.2; owner 2026-10-27 / 2026-10-28). No card, no frames, no squares behind anything: two BIG icons in the middle —
 * Player and Remote, just the icon and its name (a phone only has Remote). Choosing one: the other fades away, the chosen icon glides to the centre and grows, and underneath only what the choice needs opens, piece by piece:
 *   · Player  → the branch (type a name → matching branches appear; a name that matches nothing is a NEW branch → its address and brand), nothing about the person (the signed-in account is the asker);
 *   · Remote  → who the person is (first / last name, phone, e-mail) and the existing branch it controls.
 * The account's main admin also gets a slim "I'm the owner" bar at the bottom: his own new computer is approved at once (the normal interface, every branch — as a REMOTE: it controls but never plays and never takes a Player seat; to play from it he asks for Player) — he approves
 * everyone else, he does not wait for someone to approve him. The server gives the device no connection token until it is approved, and the app behind this screen is not even loaded (components/enrollment-hold.tsx).
 * Styles: components/enrollment-gate.css.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import "@/components/enrollment-gate.css";
import { useLocale } from "@/lib/locale-context";
import { detectDeviceLabel, detectPlatform, type EnrollmentGateApi } from "@/lib/use-enrollment-gate";
import { PlayerIcon, RemoteIcon } from "@/components/device-role-badge";
import { isPlausibleEmail, isPlausiblePhone } from "@/lib/device-enrollment";

const HE = {
  caption: "המחשב הזה עוד לא חלק מהחשבון",
  connecting: "מתחבר…",
  noStorage: "הדפדפן הזה לא שומר נתונים (חלון פרטי?). פתחו את VONO בחלון רגיל.",
  player: "נגן",
  remote: "שלט רחוק",
  change: "החלפה",
  firstName: "שם פרטי",
  lastName: "שם משפחה",
  phone: "טלפון",
  email: "מייל",
  branch: "סניף",
  branchPlaceholder: "התחילו להקליד את שם הסניף…",
  noMatch: "לא נמצא סניף בשם הזה",
  pickRemote: "בחרו סניף מהרשימה — שלט רחוק מחובר לסניף שקיים.",
  newBranch: "סניף חדש — מלאו כתובת ומותג והמנהל יחבר אותו.",
  address: "כתובת הסניף",
  brand: "מותג",
  send: "שליחת בקשה",
  sending: "שולח…",
  owner: "אני הבעלים — שליטה בכל הסניפים",
  ownerSending: "מצרף…",
  waiting: "ממתין לאישור המנהל",
  waitingSub: "נעדכן אותך כשיאושר — אפשר להשאיר את המסך הזה פתוח.",
  cantPlay: "עד שהמחשב הזה יאושר הוא לא יכול לנגן או לשלוט. אם ביקשת להיות נגן וכבר יש נגן אחר פעיל — אפשר לחכות לאישור, או לבקש מהמנהל להגדיל את מספר הנגנים.",
  expires: (d: number) => (d <= 1 ? "הבקשה תפוג היום" : `הבקשה תפוג בעוד ${d} ימים`),
  rejected: "הבקשה נדחתה",
  revoked: "האישור למכשיר הזה בוטל",
  expired: "הבקשה פגה",
  again: "בקשה חדשה",
  errors: {
    branch_required_for_player: "בחרו סניף לנגן.",
    branch_required_for_remote: "בחרו סניף מהרשימה.",
    branch_address_required: "חסרה כתובת לסניף החדש.",
    first_name_required: "חסר שם פרטי.",
    last_name_required: "חסר שם משפחה.",
    phone_invalid: "מספר הטלפון לא נראה תקין.",
    email_invalid: "כתובת המייל לא נראית תקינה.",
    too_many_pending_requests: "יש יותר מדי בקשות פתוחות. המתינו שהמנהל יטפל בהן.",
    enrollment_disabled: "האישור לא פעיל כרגע.",
    Forbidden: "רק הבעלים יכול לעשות את זה.",
    other: "משהו השתבש. נסו שוב.",
  } as Record<string, string>,
};
const EN: typeof HE = {
  caption: "This computer is not part of the account yet",
  connecting: "Connecting…",
  noStorage: "This browser does not keep data (a private window?). Open VONO in a normal window.",
  player: "Player",
  remote: "Remote",
  change: "Change",
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone",
  email: "E-mail",
  branch: "Branch",
  branchPlaceholder: "Start typing the branch name…",
  noMatch: "No branch with this name",
  pickRemote: "Pick a branch from the list — a Remote is tied to a branch that exists.",
  newBranch: "A new branch — fill in its address and brand and the manager will connect it.",
  address: "Branch address",
  brand: "Brand",
  send: "Send request",
  sending: "Sending…",
  owner: "I'm the owner — control every branch",
  ownerSending: "Joining…",
  waiting: "Waiting for the manager's approval",
  waitingSub: "We will let you know when it is approved — you can keep this screen open.",
  cantPlay: "Until this computer is approved it cannot play or control anything. If it asked to be a Player and another player is already active, wait for approval — or ask your manager to increase the number of players.",
  expires: (d: number) => (d <= 1 ? "The request expires today" : `The request expires in ${d} days`),
  rejected: "The request was declined",
  revoked: "This device's approval was cancelled",
  expired: "The request expired",
  again: "New request",
  errors: {
    branch_required_for_player: "Choose a branch for the player.",
    branch_required_for_remote: "Pick a branch from the list.",
    branch_address_required: "The new branch needs an address.",
    first_name_required: "The first name is missing.",
    last_name_required: "The last name is missing.",
    phone_invalid: "The phone number does not look right.",
    email_invalid: "The e-mail address does not look right.",
    too_many_pending_requests: "Too many open requests. Wait for the manager to handle them.",
    enrollment_disabled: "Approval is not active right now.",
    Forbidden: "Only the owner can do this.",
    other: "Something went wrong. Try again.",
  },
};

type Hit = { id: string; name: string; city: string };

/** the branch box: type a name → a few matching branches appear underneath (5 visible, scroll for the rest); picking one ties the request to that branch */
function BranchPicker(props: { he: boolean; t: typeof HE; role: "PLAYER" | "REMOTE"; text: string; picked: Hit | null; onText: (v: string) => void; onPick: (h: Hit | null) => void }): ReactElement {
  const { he, t, role, text, picked, onText, onPick } = props;
  const listId = useId();
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searched, setSearched] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (!q || (picked && picked.name === text)) {
      setHits([]);
      setSearched(false);
      return;
    }
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      void fetch(`/api/devices/enrollment/branches?q=${encodeURIComponent(q)}`, { credentials: "include", cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((j: { items?: Hit[] }) => {
          if (mine !== seq.current) return;
          setHits(Array.isArray(j.items) ? j.items : []);
          setSearched(true);
          setActive(-1);
        })
        .catch(() => {
          if (mine === seq.current) setSearched(true);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [text, picked]);

  const choose = (h: Hit) => {
    onPick(h);
    onText(h.name);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && open && active >= 0 && hits[active]) {
      e.preventDefault();
      choose(hits[active]!);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && !picked && text.trim().length > 0 && hits.length > 0;
  const typedNoPick = !picked && text.trim().length > 0;
  return (
    <div className="vono-enr-field vono-enr-branch">
      <span>{t.branch}</span>
      <input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        maxLength={80}
        dir="auto"
        placeholder={t.branchPlaceholder}
        value={text}
        data-picked={picked ? "1" : undefined}
        onChange={(e) => {
          if (picked) onPick(null);
          onText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
      />
      {showList ? (
        <ul id={listId} role="listbox" className="vono-enr-hits" dir={he ? "rtl" : "ltr"}>
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === active} data-active={i === active ? "1" : undefined} onMouseDown={(e) => { e.preventDefault(); choose(h); }} onMouseEnter={() => setActive(i)}>
              <b dir="auto">{h.name}</b>
              {h.city ? <small dir="auto">{h.city}</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {typedNoPick && searched && hits.length === 0 && role === "REMOTE" ? <small className="vono-enr-hint">{t.noMatch}. {t.pickRemote}</small> : null}
      {typedNoPick && role === "REMOTE" && hits.length > 0 ? <small className="vono-enr-hint">{t.pickRemote}</small> : null}
    </div>
  );
}

export function EnrollmentGateCard({ gate, loading }: { gate: EnrollmentGateApi; loading: boolean }): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const { state, request, becomeOwner, noStorage } = gate;
  const platform = detectPlatform();
  const phone = platform !== "browser";
  const [chosen, setChosen] = useState<"PLAYER" | "REMOTE" | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [tel, setTel] = useState("");
  const [mail, setMail] = useState("");
  const [branchText, setBranchText] = useState("");
  const [picked, setPicked] = useState<Hit | null>(null);
  const [address, setAddress] = useState("");
  const [brand, setBrand] = useState("");
  const [busy, setBusy] = useState<"send" | "owner" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ownerErr, setOwnerErr] = useState<string | null>(null);
  const [again, setAgain] = useState(false);

  // a phone can only be a Remote: that tile is already the chosen one
  const role: "PLAYER" | "REMOTE" | null = phone ? "REMOTE" : chosen;
  const st = state && state.enforced ? state : null;
  const showForm = !loading && !noStorage && !!st && (st.status === "unknown" || again);
  const newBranch = role === "PLAYER" && !picked && branchText.trim().length >= 2;
  const valid =
    role === "REMOTE"
      ? first.trim().length > 0 && last.trim().length > 0 && isPlausiblePhone(tel.trim()) && isPlausibleEmail(mail.trim().toLowerCase()) && !!picked
      : role === "PLAYER"
        ? !!picked || (newBranch && address.trim().length >= 3)
        : false;

  const send = async () => {
    if (!role) return;
    setBusy("send");
    setErr(null);
    const r = await request({
      role,
      branchId: picked?.id ?? null,
      branchName: picked ? "" : branchText.trim(),
      branchAddress: picked || role !== "PLAYER" ? "" : address.trim(),
      brandName: picked || role !== "PLAYER" ? "" : brand.trim(),
      firstName: role === "REMOTE" ? first.trim() : "",
      lastName: role === "REMOTE" ? last.trim() : "",
      phone: role === "REMOTE" ? tel.trim() : "",
      email: role === "REMOTE" ? mail.trim() : "",
      label: detectDeviceLabel(),
      note: "",
      platform,
    });
    setBusy(null);
    if (!r.ok) setErr(t.errors[r.error ?? "other"] ?? t.errors.other!);
    else setAgain(false);
  };
  const owner = async () => {
    setBusy("owner");
    setOwnerErr(null);
    const r = await becomeOwner(platform, detectDeviceLabel());
    setBusy(null);
    if (!r.ok) setOwnerErr(t.errors[r.error ?? "other"] ?? t.errors.other!);
  };

  const daysLeft = st && st.status === "pending" ? Math.max(0, Math.ceil((new Date(st.expiresAt).getTime() - Date.now()) / 86_400_000)) : 0;
  const ownerBar = !!st && st.status !== "approved" && st.ownerAllowed === true && !loading && !noStorage;

  return (
    <div className="vono-enr" data-chosen={role ?? ""} dir={he ? "rtl" : "ltr"} role="dialog" aria-modal="true" aria-label={t.caption}>
      <div className="vono-enr-stage" data-chosen={role ?? ""}>
        {noStorage ? (
          <p className="vono-enr-sub">{t.noStorage}</p>
        ) : loading || !st ? (
          <>
            <p className="vono-enr-sub">{t.connecting}</p>
            <p className="vono-enr-dots" aria-hidden><i /><i /><i /></p>
          </>
        ) : showForm ? (
          <>
            {!role ? <p className="vono-enr-caption">{t.caption}</p> : null}
            {st.status === "rejected" || st.status === "revoked" || st.status === "expired" ? (
              <p className="vono-enr-state">{st.status === "rejected" ? t.rejected : st.status === "revoked" ? t.revoked : t.expired}{st.status === "rejected" && st.decisionNote ? ` — ${st.decisionNote}` : ""}</p>
            ) : null}
            <div className="vono-enr-tiles" role="radiogroup">
              {phone ? null : (
                <button type="button" role="radio" aria-checked={role === "PLAYER"} aria-label={t.player} className="vono-enr-tile" data-kind="player" data-state={role === "PLAYER" ? "on" : role ? "away" : "idle"} onClick={() => setChosen((c) => (c === "PLAYER" ? null : "PLAYER"))} tabIndex={role === "REMOTE" ? -1 : 0}>
                  <span className="ic"><PlayerIcon /></span>
                  <b>{t.player}</b>
                </button>
              )}
              <button type="button" role="radio" aria-checked={role === "REMOTE"} aria-label={t.remote} className="vono-enr-tile" data-kind="remote" data-state={role === "REMOTE" ? "on" : role ? "away" : "idle"} onClick={() => !phone && setChosen((c) => (c === "REMOTE" ? null : "REMOTE"))} tabIndex={role === "PLAYER" ? -1 : 0}>
                <span className="ic"><RemoteIcon /></span>
                <b>{t.remote}</b>
              </button>
            </div>
            {role ? (
              <div className="vono-enr-form" data-kind={role.toLowerCase()}>
                {role === "REMOTE" ? (
                  <>
                    <div className="vono-enr-row">
                      <label className="vono-enr-field">
                        <span>{t.firstName}</span>
                        <input type="text" autoComplete="given-name" maxLength={60} dir="auto" value={first} onChange={(e) => setFirst(e.target.value)} />
                      </label>
                      <label className="vono-enr-field">
                        <span>{t.lastName}</span>
                        <input type="text" autoComplete="family-name" maxLength={60} dir="auto" value={last} onChange={(e) => setLast(e.target.value)} />
                      </label>
                    </div>
                    <div className="vono-enr-row">
                      <label className="vono-enr-field">
                        <span>{t.phone}</span>
                        <input type="tel" inputMode="tel" autoComplete="tel" maxLength={24} dir="ltr" value={tel} onChange={(e) => setTel(e.target.value)} />
                      </label>
                      <label className="vono-enr-field">
                        <span>{t.email}</span>
                        <input type="email" inputMode="email" autoComplete="email" maxLength={120} dir="ltr" value={mail} onChange={(e) => setMail(e.target.value)} />
                      </label>
                    </div>
                  </>
                ) : null}
                <BranchPicker he={he} t={t} role={role} text={branchText} picked={picked} onText={setBranchText} onPick={setPicked} />
                {newBranch ? (
                  <>
                    <p className="vono-enr-hint">{t.newBranch}</p>
                    <div className="vono-enr-row">
                      <label className="vono-enr-field">
                        <span>{t.address}</span>
                        <input type="text" autoComplete="street-address" maxLength={160} dir="auto" value={address} onChange={(e) => setAddress(e.target.value)} />
                      </label>
                      <label className="vono-enr-field">
                        <span>{t.brand}</span>
                        <input type="text" maxLength={80} dir="auto" value={brand} onChange={(e) => setBrand(e.target.value)} />
                      </label>
                    </div>
                  </>
                ) : null}
                {err ? <p className="vono-enr-err" role="alert">{err}</p> : null}
                <button type="button" className="vono-enr-send" disabled={busy !== null || !valid} onClick={() => void send()}>{busy === "send" ? t.sending : t.send}</button>
                {phone ? null : <button type="button" className="vono-enr-link" onClick={() => setChosen(null)}>{t.change}</button>}
              </div>
            ) : null}
          </>
        ) : st.status === "pending" ? (
          <>
            {/* owner 2026-10-31: a clear "cannot play" mark and what to do — wait for approval or raise the number of players */}
            <span className="vono-enr-x" aria-hidden><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg></span>
            <h2 className="vono-enr-h">{t.waiting}</h2>
            <p className="vono-enr-dots" aria-hidden><i /><i /><i /></p>
            <p className="vono-enr-sub">{t.waitingSub}</p>
            <p className="vono-enr-sub vono-enr-small">{t.cantPlay}</p>
            <p className="vono-enr-sub vono-enr-small">{t.expires(daysLeft)}</p>
          </>
        ) : (
          <>
            <h2 className="vono-enr-h">{st.status === "rejected" ? t.rejected : st.status === "revoked" ? t.revoked : t.expired}</h2>
            {st.status === "rejected" && st.decisionNote ? <p className="vono-enr-sub">{st.decisionNote}</p> : null}
            <button type="button" className="vono-enr-send" onClick={() => setAgain(true)}>{t.again}</button>
          </>
        )}
      </div>
      {ownerBar ? (
        <div className="vono-enr-ownerwrap">
          {ownerErr ? <p className="vono-enr-err" role="alert">{ownerErr}</p> : null}
          <button type="button" className="vono-enr-owner" disabled={busy !== null} onClick={() => void owner()}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 8l4 4 4-7 4 7 4-4-2 10H6z" /></svg>
            <span>{busy === "owner" ? t.ownerSending : t.owner}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
