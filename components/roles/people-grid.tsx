"use client";

/**
 * PEOPLE — the Permissions screen's main area (owner 2026-10-30): one SQUARE for each person, the new-person PLUS first (the start edge: right in Hebrew, left in English), a SEARCH bar on top for the
 * name or the rank (role). A square opens a glass window with the person's details and — with roles on — their role; a person waiting to join is a square too (amber dot) whose window approves / rejects
 * with a role; the plus opens the one-time code, its QR (the sign-up page with the code inside, `/signup?join=…`) and the link. Reads /api/people, /api/join/requests, /api/roles; nothing here touches a
 * database by itself. Replaces the earlier People list and "People joining" panels.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/i18n/use-tr";
import { JOIN_CHANGED_EVENT } from "@/lib/use-join-pending";
import { JOIN_CODE_RENEW_MS } from "@/lib/join-by-code";
import { buildJoinLink } from "@/lib/join-link";
import { QrCode } from "@/components/roles/qr-code";
import "./people-grid.css";

type Person = { userId: string; name: string; email: string; level: "owner" | "manager" | "member"; roleId: string | null; roleName: string | null; status: "active" | "paused" | "disabled"; lastSignInAt: string | null; joinedAt: string; isYou: boolean };
type Req = { id: string; email: string; firstName: string; lastName: string; phone: string; hasAccount: boolean; requestedAt: string; expiresAt: string };
type Role = { id: string; name: string };

const ERRORS: Record<string, string> = {
  not_yourself: "You cannot change your own role.",
  protected_member: "The owner and workspace admins keep their level.",
  role_not_found: "That role no longer exists.",
  limit: "This business has no room for more people. Free a seat or raise the limit first.",
  not_pending: "This request was already handled.",
  too_many_codes: "There are already 10 unused codes. Wait for one to expire.",
};

const TONES = ["#4f6df5", "#8a5cf6", "#d4568b", "#e0793a", "#2f9e8f", "#c2a23a", "#5aa0d6", "#8b8f98"];
function toneFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}
const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();

function ago(iso: string | null, tr: (t: string, v?: Record<string, string | number>) => string): string {
  if (!iso) return tr("Never signed in");
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 2) return tr("Just now");
  if (min < 60) return tr("{n} min ago", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return tr("{n} h ago", { n: h });
  return tr("{n} days ago", { n: Math.round(h / 24) });
}

function Win({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false); // the portal exists only in the browser
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div className="sb-pg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sb-pg-win" role="dialog" aria-modal="true" aria-label={label}>
        <button type="button" className="sb-pg-x" onClick={onClose} aria-label="×">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function PeopleGrid() {
  const tr = useTr();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [joinOn, setJoinOn] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ kind: "person"; id: string } | { kind: "request"; id: string } | { kind: "add" } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickRole, setPickRole] = useState<Record<string, string>>({});
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  const makeCodeRef = useRef<(silent?: boolean) => Promise<void>>(async () => undefined);

  const load = useCallback(async () => {
    try {
      const pr = await fetch("/api/people", { credentials: "include", cache: "no-store" });
      if (!pr.ok) return; // not an admin: stay hidden
      const pj = (await pr.json()) as { people?: Person[] };
      let reqList: Req[] = [];
      let on = false;
      try {
        const rr = await fetch("/api/join/requests", { credentials: "include", cache: "no-store" });
        const rj = rr.ok ? ((await rr.json()) as { enabled?: boolean; requests?: Req[] }) : null;
        on = Boolean(rj?.enabled);
        reqList = rj?.requests ?? [];
      } catch {
        /* no join */
      }
      let roleList: Role[] = [];
      try {
        const xr = await fetch("/api/roles", { credentials: "include", cache: "no-store" });
        const xj = xr.ok ? ((await xr.json()) as { enabled?: boolean; roles?: Role[] }) : null;
        if (xj?.enabled) roleList = xj.roles ?? [];
      } catch {
        /* no roles: the details are read-only */
      }
      if (!alive.current) return;
      setPeople(pj.people ?? []);
      setReqs(reqList);
      setJoinOn(on);
      setRoles(roleList);
    } catch {
      /* offline — keep what is shown */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => {
      alive.current = false;
      window.clearTimeout(first);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(t);
    };
  }, [load]);

  // the countdown of the code ticks only while the "add a person" window is open
  useEffect(() => {
    if (open?.kind !== "add") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [open?.kind]);

  // the "add a person" window makes its own code the moment it opens and renews it every minute while it stays open (owner 2026-10-31); each code still works once
  useEffect(() => {
    if (open?.kind !== "add") return;
    const first = window.setTimeout(() => void makeCodeRef.current(true), 0);
    const t = window.setInterval(() => void makeCodeRef.current(true), JOIN_CODE_RENEW_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, [open?.kind]);

  const fail = (c?: string) => setError(tr(ERRORS[c ?? ""] ?? "Something went wrong. Please try again."));
  const close = useCallback(() => {
    setOpen(null);
    setError("");
    setCopied(false);
  }, []);

  async function makeCode(silent = false) {
    if (!silent) setBusy(true);
    setError("");
    setCopied(false);
    try {
      const r = await fetch("/api/join/codes", { method: "POST", credentials: "include" });
      const j = (await r.json().catch(() => ({}))) as { code?: string; expiresAt?: string; error?: string };
      if (!r.ok || !j.code || !j.expiresAt) {
        fail(j.error);
        return;
      }
      setCode({ code: j.code, expiresAt: new Date(j.expiresAt).getTime() });
      setNow(Date.now());
      window.dispatchEvent(new Event(JOIN_CHANGED_EVENT)); // the screens re-check at once and then every few seconds while this code is on show
    } catch {
      fail();
    } finally {
      if (!silent) setBusy(false);
    }
  }

  makeCodeRef.current = makeCode;

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      const chosen = pickRole[id] ?? (roles.length > 0 ? roles[roles.length - 1].id : "MEMBER");
      const body = roles.length > 0 ? { decision, roleId: chosen } : { decision, role: chosen === "MANAGER" ? "MANAGER" : "MEMBER" };
      const r = await fetch(`/api/join/requests/${id}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        fail(j.error);
        return;
      }
      close();
      await load();
      window.dispatchEvent(new Event(JOIN_CHANGED_EVENT)); // the red circle re-counts at once
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  async function setRole(p: Person, roleId: string) {
    setError("");
    try {
      const r = await fetch(`/api/people/${p.userId}/role`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ roleId }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        fail(j.error);
      }
      await load();
    } catch {
      fail();
    }
  }

  const levelLabel = useCallback((p: Person) => (p.level === "owner" ? tr("Owner") : p.level === "manager" ? tr("Manager") : tr("Member")), [tr]);
  const statusLabel = (p: Person) => (p.status === "active" ? tr("Active") : p.status === "paused" ? tr("Paused") : tr("Disabled"));

  const q = query.trim().toLowerCase();
  const shownPeople = useMemo(() => (people ?? []).filter((p) => !q || [p.name, p.email, p.roleName ?? "", levelLabel(p)].some((x) => x.toLowerCase().includes(q))), [people, q, levelLabel]);
  const shownReqs = useMemo(() => reqs.filter((r) => !q || [`${r.firstName} ${r.lastName}`, r.email, tr("Waiting for approval")].some((x) => x.toLowerCase().includes(q))), [reqs, q, tr]);

  if (people === null) return null;
  const openPerson = open?.kind === "person" ? people.find((p) => p.userId === open.id) : undefined;
  const openReq = open?.kind === "request" ? reqs.find((r) => r.id === open.id) : undefined;
  const link = code && typeof window !== "undefined" ? buildJoinLink(window.location.origin, code.code) : "";
  const left = code ? code.expiresAt - now : 0;
  const live = code && left > 0;

  return (
    <section className="sb-pg" aria-label={tr("People")}>
      <div className="sb-pg-top">
        <h2 className="sb-pg-title">{tr("People")}</h2>
        <label className="sb-pg-search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Search by name or role")} aria-label={tr("Search by name or role")} />
        </label>
      </div>

      <div className="sb-pg-grid">
        {joinOn ? (
          <button type="button" className="sb-pg-tile sb-pg-tile--add" onClick={() => { setOpen({ kind: "add" }); setCode(null); void makeCode(); }} aria-label={tr("Add a person")}>
            <span className="sb-pg-plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg></span>
            <span className="sb-pg-name">{tr("Add a person")}</span>
          </button>
        ) : null}

        {shownReqs.map((r) => {
          const name = `${r.firstName} ${r.lastName}`.trim();
          return (
            <button key={r.id} type="button" className="sb-pg-tile" onClick={() => setOpen({ kind: "request", id: r.id })}>
              <span className="sb-pg-dot sb-pg-dot--wait" aria-hidden />
              <span className="sb-pg-avatar" style={{ background: toneFor(name) }}>{initialOf(name)}</span>
              <span className="sb-pg-name">{name}</span>
              <span className="sb-pg-sub sb-pg-sub--wait">{tr("Waiting for approval")}</span>
            </button>
          );
        })}

        {shownPeople.map((p) => (
          <button key={p.userId} type="button" className="sb-pg-tile" onClick={() => setOpen({ kind: "person", id: p.userId })}>
            <span className={`sb-pg-dot${p.status === "active" ? "" : " sb-pg-dot--off"}`} aria-hidden />
            <span className="sb-pg-avatar" style={{ background: toneFor(p.name) }}>{initialOf(p.name)}</span>
            <span className="sb-pg-name">{p.name}{p.isYou ? ` · ${tr("You")}` : ""}</span>
            <span className="sb-pg-sub">{p.roleName ?? levelLabel(p)}</span>
          </button>
        ))}

        {q && shownPeople.length === 0 && shownReqs.length === 0 ? <p className="sb-pg-empty">{tr("No one matches.")}</p> : null}
      </div>

      {openPerson ? (
        <Win onClose={close} label={openPerson.name}>
          <div className="sb-pg-hero">
            <span className="sb-pg-avatar" style={{ background: toneFor(openPerson.name) }}>{initialOf(openPerson.name)}</span>
            <b>{openPerson.name}</b>
            <small><span dir="ltr" style={{ display: "inline-block" }}>{openPerson.email}</span></small>
          </div>
          <dl className="sb-pg-facts">
            <div><dt>{tr("Level")}</dt><dd>{levelLabel(openPerson)}</dd></div>
            <div><dt>{tr("State")}</dt><dd>{statusLabel(openPerson)}</dd></div>
            <div><dt>{tr("Last sign-in")}</dt><dd>{ago(openPerson.lastSignInAt, tr)}</dd></div>
            <div><dt>{tr("Joined")}</dt><dd>{new Date(openPerson.joinedAt).toLocaleDateString()}</dd></div>
            {roles.length > 0 ? (
              <div>
                <dt>{tr("Role")}</dt>
                <dd>
                  {openPerson.level === "owner" || openPerson.isYou ? (
                    openPerson.roleName ?? levelLabel(openPerson)
                  ) : (
                    <select className="sb-pg-select" value={openPerson.roleId ?? ""} onChange={(e) => e.target.value && void setRole(openPerson, e.target.value)} aria-label={tr("Role")}>
                      {openPerson.roleId ? null : <option value="">—</option>}
                      {roles.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
          {error ? <p className="sb-pg-err" role="alert">{error}</p> : null}
        </Win>
      ) : null}

      {openReq ? (
        <Win onClose={close} label={`${openReq.firstName} ${openReq.lastName}`}>
          <div className="sb-pg-hero">
            <span className="sb-pg-avatar" style={{ background: toneFor(openReq.firstName + openReq.lastName) }}>{initialOf(openReq.firstName)}</span>
            <b>{openReq.firstName} {openReq.lastName}</b>
            <small>{tr("Waiting for approval")}</small>
          </div>
          <dl className="sb-pg-facts">
            <div><dt>{tr("E-mail")}</dt><dd><span dir="ltr" style={{ display: "inline-block" }}>{openReq.email}</span></dd></div>
            {openReq.phone ? <div><dt>{tr("Phone")}</dt><dd><span dir="ltr" style={{ display: "inline-block" }}>{openReq.phone}</span></dd></div> : null}
            <div><dt>{tr("Account")}</dt><dd>{openReq.hasAccount ? tr("Already has an account") : tr("New account")}</dd></div>
            <div>
              <dt>{tr("Role")}</dt>
              <dd>
                <select className="sb-pg-select" aria-label={tr("Role")} value={pickRole[openReq.id] ?? (roles.length > 0 ? roles[roles.length - 1].id : "MEMBER")} onChange={(e) => setPickRole((s) => ({ ...s, [openReq.id]: e.target.value }))}>
                  {roles.length > 0 ? roles.map((o) => <option key={o.id} value={o.id}>{o.name}</option>) : (<><option value="MEMBER">{tr("Member")}</option><option value="MANAGER">{tr("Manager")}</option></>)}
                </select>
              </dd>
            </div>
          </dl>
          <div className="sb-pg-actions">
            <button type="button" className="sb-pg-btn sb-pg-btn--main" disabled={busy} onClick={() => void decide(openReq.id, "approve")}>{tr("Approve")}</button>
            <button type="button" className="sb-pg-btn" disabled={busy} onClick={() => void decide(openReq.id, "reject")}>{tr("Reject")}</button>
          </div>
          {error ? <p className="sb-pg-err" role="alert">{error}</p> : null}
        </Win>
      ) : null}

      {open?.kind === "add" ? (
        <Win onClose={close} label={tr("Add a person")}>
          <div className="sb-pg-hero"><b>{tr("Add a person")}</b><small>{tr("Scan the code with a phone camera, or type it at sign-up.")}</small></div>
          {live ? (
            <>
              <div className="sb-pg-qr"><QrCode value={link} size={196} label={tr("QR code to join")} /></div>
              <p className="sb-pg-code" dir="ltr">{code.code}</p>
              <p className="sb-pg-left">{tr("Works once · renews every minute")}</p>
              <div className="sb-pg-actions" style={{ paddingTop: 0 }}>
                <button type="button" className="sb-pg-btn sb-pg-btn--main" onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopied(true)).catch(() => undefined); }}>{copied ? tr("Copied") : tr("Copy link")}</button>
                <button type="button" className="sb-pg-btn" disabled={busy} onClick={() => void makeCode()}>{tr("New code")}</button>
              </div>
            </>
          ) : (
            <div className="sb-pg-actions">
              <button type="button" className="sb-pg-btn sb-pg-btn--main" disabled={busy} onClick={() => void makeCode()}>{code ? tr("New code") : tr("Create join code")}</button>
            </div>
          )}
          <p className="sb-pg-hint">{tr("The person fills in their details and you approve them here.")}</p>
          {error ? <p className="sb-pg-err" role="alert">{error}</p> : null}
        </Win>
      ) : null}
    </section>
  );
}
