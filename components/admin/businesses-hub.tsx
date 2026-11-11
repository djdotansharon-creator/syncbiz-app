"use client";

/**
 * Platform → ACCOUNTS (owner 2026-11-10, reshaped 2026-11-11): the platform owner's back office for customer accounts, in the
 * permissions room's visual language. 2026-11-11 (owner, option א): squares do not scale to hundreds of international customers →
 * the list is a TABLE (search, status filters, sortable columns: plan, status, branches, devices, private banks, last active),
 * like the customer lists of mature SaaS back offices. A row opens the account's own page with tabs: Music banks (open / close
 * a PRIVATE bank, optional end date), Chains & branches, Account. The top tab Music banks lists, per bank, the accounts it is
 * open to + a search to open it for another account. SUPER_ADMIN only (the data routes answer 403 to anyone else).
 * Styles: the permissions room's own classes (people-grid.css, permissions-hub.css) + businesses-hub.css for the new pieces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import WorkspaceActions from "@/components/admin/workspace-actions";
import WorkspaceTestDeleteButton from "@/components/admin/workspace-test-delete-button";
import "@/components/roles/people-grid.css";
import "@/components/roles/permissions-hub.css";
import "@/components/admin/businesses-hub.css";

type Bank = { id: string; name: string; description: string; trackCount: number; durationSeconds: number };
type Grant = { bankId: string; expiresAt: string | null; since: string };
type Business = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  ownerEmail: string | null;
  ownerIsSuperAdmin: boolean;
  createdAt: string;
  status: string | null;
  plan: string | null;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  /** WorkspaceEntitlement maxes (null = no entitlement row) */
  limits: { branches: number; devices: number; users: number; playlists: number } | null;
  overLimit: boolean;
  users: number;
  playlists: number;
  branchCount: number;
  devices: number;
  lastActiveAt: string | null;
  chains:{ id: string; name: string; isDefault: boolean; color: string | null }[];
  branches: { id: string; name: string; chainId: string | null }[];
  grants: Grant[];
};

const TONES = ["#4f6df5", "#8a5cf6", "#d4568b", "#e0793a", "#2f9e8f", "#c2a23a", "#5aa0d6", "#8b8f98"];
function toneFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}
const initialOf = (name: string): string => (name.trim()[0] ?? "?").toUpperCase();
const fmtDay = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const dayInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");
function fmtHours(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
const isLive = (g: Grant): boolean => g.expiresAt == null || new Date(g.expiresAt).getTime() > Date.now();
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Active", tone: "ok" },
  TRIALING: { label: "Trial", tone: "info" },
  PAST_DUE: { label: "Past due", tone: "warn" },
  SUSPENDED: { label: "Suspended", tone: "bad" },
  CANCELLED: { label: "Cancelled", tone: "off" },
};
function StatusPill({ status }: { status: string | null }) {
  const s = status ? STATUS[status] : undefined;
  return <span className="sb-bz-pill" data-tone={s?.tone ?? "off"}>{s?.label ?? "No plan"}</span>;
}
function fmtAgo(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 2) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 60 ? `${d} days ago` : fmtDay(iso);
}
/** "in 5 days" / "ended 3 days ago" for a trial end (the same idea as Platform · Workspaces). */
function fmtUntil(iso: string | null, now: number): string {
  if (!iso) return "";
  const d = Math.round((new Date(iso).getTime() - now) / 86_400_000);
  if (d === 0) return "today";
  return d > 0 ? `in ${plural(d, "day", "days")}` : `ended ${plural(-d, "day", "days")} ago`;
}
/** used / max — the max comes from the account's plan limits; over the limit is marked (UI only, not enforced). */
function Usage({ used, max }: { used: number; max: number | undefined }) {
  if (max == null) return <>{used}</>;
  return (
    <span className={used > max ? "sb-bz-over" : undefined} title={used > max ? "Over the plan limit" : undefined}>
      {used}<span className="sb-bz-max"> / {max}</span>
    </span>
  );
}
type SortKey = "name" | "trial" | "users" | "branches" | "devices" | "playlists" | "banks" | "active" | "created";
type Filter = "all" | "ACTIVE" | "TRIALING" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | "over" | "noplan" | "banks";

function Switch({ on, busy, label, onChange }: { on: boolean; busy: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} data-on={on ? "1" : "0"} className="sb-tg" disabled={busy} onClick={() => onChange(!on)}>
      <span className="sb-tg-knob" />
    </button>
  );
}

export function BusinessesHub() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"businesses" | "banks">("businesses");
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const [bankQ, setBankQ] = useState<Record<string, string>>({});
  const [now] = useState(() => Date.now()); // "last active" is relative to when the list loaded
  const [busy, setBusy] = useState<string | null>(null);
  const [adminId, setAdminId] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/platform/music-banks", { credentials: "include", cache: "no-store" });
      if (!r.ok) {
        setError(r.status === 403 ? "Only the platform owner can open this page." : "Could not load the businesses.");
        return;
      }
      const j = (await r.json()) as { banks: Bank[]; businesses: Business[]; adminId: string };
      setAdminId(j.adminId);
      setBanks(j.banks);
      setBusinesses(j.businesses);
      setError(null);
    } catch {
      setError("Could not load the businesses.");
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  /** Open / close one bank for one business (and optionally set its end date). The row updates from the server's answer. */
  const setGrant = useCallback(async (businessId: string, bankId: string, open: boolean, expiresAt: string | null) => {
    const key = `${businessId}:${bankId}`;
    setBusy(key);
    setError(null);
    try {
      const r = await fetch(`/api/admin/platform/workspaces/${encodeURIComponent(businessId)}/music-banks`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankId, open, expiresAt }),
      });
      const j = (await r.json().catch(() => ({}))) as { grant?: Grant | null; error?: string };
      if (!r.ok) {
        setError(j.error ?? "The change was not saved.");
        return;
      }
      setBusinesses((list) =>
        (list ?? []).map((b) =>
          b.id !== businessId ? b : { ...b, grants: [...b.grants.filter((g) => g.bankId !== bankId), ...(j.grant ? [j.grant] : [])] },
        ),
      );
    } catch {
      setError("The change was not saved.");
    } finally {
      setBusy(null);
    }
  }, []);

  const liveCount = (b: Business): number => b.grants.filter(isLive).length;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, banks: 0, over: 0, noplan: 0 };
    for (const b of businesses ?? []) {
      c.all++;
      if (b.status) c[b.status] = (c[b.status] ?? 0) + 1;
      if (b.grants.some(isLive)) c.banks++;
      if (b.overLimit) c.over++;
      if (!b.limits) c.noplan++;
    }
    return c;
  }, [businesses]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = (businesses ?? []).filter((b) => {
      if (filter === "banks") { if (!b.grants.some(isLive)) return false; }
      else if (filter === "over") { if (!b.overLimit) return false; }
      else if (filter === "noplan") { if (b.limits) return false; }
      else if (filter !== "all" && b.status !== filter) return false;
      return !n || [b.name, b.slug, b.ownerEmail ?? "", ...b.chains.map((c) => c.name)].some((s) => s.toLowerCase().includes(n));
    });
    const val = (b: Business): number | string => {
      switch (sort.key) {
        case "trial": return b.trialEndsAt ? new Date(b.trialEndsAt).getTime() : sort.dir === 1 ? Number.MAX_SAFE_INTEGER : 0; // no trial end = last
        case "users": return b.users;
        case "playlists": return b.playlists;
        case "branches": return b.branchCount;
        case "devices": return b.devices;
        case "banks": return b.grants.filter(isLive).length;
        case "active": return b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
        case "created": return new Date(b.createdAt).getTime();
        default: return b.name.toLowerCase();
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [businesses, q, filter, sort]);

  const open = openId ? (businesses ?? []).find((b) => b.id === openId) ?? null : null;
  if (open) {
    return (
      <BusinessPage
        business={open}
        banks={banks}
        busy={busy}
        error={error}
        adminId={adminId}
        now={now}
        onBack={() => setOpenId(null)}
        onSetGrant={setGrant}
        onChanged={() => void load()}
      />
    );
  }

  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "name" || key === "trial" ? 1 : -1 }));
  const th = (k: SortKey, label: string, className?: string) => (
    <th className={className} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="sb-bz-th" onClick={() => sortBy(k)}>
        {label}
        <span className="sb-bz-caret" aria-hidden>{sort.key === k ? (sort.dir === 1 ? "↑" : "↓") : ""}</span>
      </button>
    </th>
  );
  const FILTERS: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "ACTIVE", label: "Active" },
    { id: "TRIALING", label: "Trial" },
    { id: "PAST_DUE", label: "Past due" },
    { id: "SUSPENDED", label: "Suspended" },
    { id: "CANCELLED", label: "Cancelled" },
    { id: "over", label: "Over limit" },
    { id: "noplan", label: "No plan" },
    { id: "banks", label: "With private banks" },
  ];

  return (
    <div className="sb-ph sb-bz">
      <div className="sb-ph-tabs" role="tablist" aria-label="Accounts">
        <button type="button" role="tab" aria-selected={tab === "businesses"} className="sb-ph-tab" onClick={() => setTab("businesses")}>Accounts</button>
        <button type="button" role="tab" aria-selected={tab === "banks"} className="sb-ph-tab" onClick={() => setTab("banks")}>Music banks</button>
      </div>

      {error ? <p className="sb-rh-err" role="alert">{error}</p> : null}
      {businesses === null && !error ? <p className="sb-rh-empty">Loading…</p> : null}

      {businesses !== null && tab === "businesses" ? (
        <section className="sb-pg" aria-label="Accounts">
          <div className="sb-pg-top">
            <h2 className="sb-pg-title">Accounts <small className="sb-bz-count">{businesses.length}</small></h2>
            <label className="sb-pg-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Account, chain or owner email" aria-label="Search accounts" />
            </label>
          </div>
          <div className="sb-bz-filters" role="group" aria-label="Filter accounts">
            {FILTERS.filter((f) => f.id === "all" || (counts[f.id] ?? 0) > 0).map((f) => (
              <button key={f.id} type="button" className="sb-bz-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                {f.label} <span>{counts[f.id] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="sb-bz-tablewrap">
            <table className="sb-bz-table">
              <thead>
                <tr>
                  {th("name", "Account")}
                  <th>Status</th>
                  <th>Plan</th>
                  {th("trial", "Trial ends")}
                  {th("users", "Users", "sb-bz-num")}
                  {th("branches", "Branches", "sb-bz-num")}
                  {th("devices", "Devices", "sb-bz-num")}
                  {th("playlists", "Playlists", "sb-bz-num sb-bz-opt")}
                  {th("banks", "Private banks", "sb-bz-num")}
                  {th("active", "Last active")}
                  {th("created", "Created", "sb-bz-opt")}
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => {
                  const live = liveCount(b);
                  return (
                    <tr key={b.id} onClick={() => setOpenId(b.id)}>
                      <td>
                        <button type="button" className="sb-bz-acct" onClick={(e) => { e.stopPropagation(); setOpenId(b.id); }}>
                          <span className="sb-pg-avatar sb-bz-mini" style={{ background: toneFor(b.name) }} aria-hidden>{initialOf(b.name)}</span>
                          <span className="sb-bz-acctname">
                            <b>{b.name}</b>
                            <small>{b.ownerEmail ?? "No owner"}</small>
                            <small className="sb-bz-mono">{b.slug}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <StatusPill status={b.status} />
                        {b.overLimit ? <span className="sb-bz-pill sb-bz-overpill" data-tone="warn" title="Uses more than the plan allows (not enforced)">Over limit</span> : null}
                      </td>
                      <td className="sb-bz-plan">{b.plan ?? <span className="sb-bz-dim">—</span>}</td>
                      <td>
                        {b.trialEndsAt ? (
                          <span className="sb-bz-two">
                            <span>{fmtDay(b.trialEndsAt)}</span>
                            <small className={new Date(b.trialEndsAt).getTime() < now ? "sb-bz-warn" : undefined}>{fmtUntil(b.trialEndsAt, now)}</small>
                          </span>
                        ) : <span className="sb-bz-dim">—</span>}
                      </td>
                      <td className="sb-bz-num"><Usage used={b.users} max={b.limits?.users} /></td>
                      <td className="sb-bz-num"><Usage used={b.branchCount} max={b.limits?.branches} /></td>
                      <td className="sb-bz-num"><Usage used={b.devices} max={b.limits?.devices} /></td>
                      <td className="sb-bz-num sb-bz-opt"><Usage used={b.playlists} max={b.limits?.playlists} /></td>
                      <td className="sb-bz-num">{live > 0 ? <span className="sb-bz-banks">{live}</span> : <span className="sb-bz-dim">—</span>}</td>
                      <td className={b.lastActiveAt ? "" : "sb-bz-dim"}>{fmtAgo(b.lastActiveAt, now)}</td>
                      <td className="sb-bz-opt sb-bz-dim">{fmtDay(b.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 ? <p className="sb-pg-empty">No account matches.</p> : null}
          </div>
          <p className="sb-bz-note">Users, branches, devices and playlists show used / plan limit. Over the limit is marked only — it is not enforced.</p>
        </section>
      ) : null}

      {businesses !== null && tab === "banks" ? (
        <section className="sb-bz-banks-tab" aria-label="Music banks">
          {banks.map((bank) => {
            const holders = businesses.filter((b) => b.grants.some((g) => g.bankId === bank.id));
            const openCount = holders.filter((b) => b.grants.some((g) => g.bankId === bank.id && isLive(g))).length;
            const find = (bankQ[bank.id] ?? "").trim().toLowerCase();
            const candidates = find
              ? businesses.filter((b) => !holders.includes(b) && [b.name, b.slug, b.ownerEmail ?? ""].some((s) => s.toLowerCase().includes(find))).slice(0, 8)
              : [];
            const row = (b: Business) => {
              const g = b.grants.find((x) => x.bankId === bank.id) ?? null;
              const on = g != null && isLive(g);
              return (
                <div key={b.id} className="sb-rh-row">
                  <span className="sb-pg-avatar sb-bz-mini" style={{ background: toneFor(b.name) }}>{initialOf(b.name)}</span>
                  <div className="sb-rh-rowtext">
                    <b>{b.name}</b>
                    <small>{g ? (on ? (g.expiresAt ? `Open until ${fmtDay(g.expiresAt)}` : "Open · no end date") : `Ended ${fmtDay(g.expiresAt)}`) : "Closed"}{b.ownerEmail ? ` · ${b.ownerEmail}` : ""}</small>
                  </div>
                  <Switch on={on} busy={busy === `${b.id}:${bank.id}`} label={`${bank.name} for ${b.name}`} onChange={(next) => void setGrant(b.id, bank.id, next, null)} />
                </div>
              );
            };
            return (
              <div key={bank.id} className="sb-bz-bank">
                <div className="sb-rh-head">
                  <span className="sb-bz-bankicon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                  </span>
                  <div className="sb-rh-rowtext">
                    <b className="sb-bz-bankname">{bank.name}</b>
                    <small>Private · {plural(bank.trackCount, "song", "songs")} · {fmtHours(bank.durationSeconds)} · open to {plural(openCount, "account", "accounts")}</small>
                  </div>
                </div>
                <p className="sb-rh-grouphint">{bank.description}</p>
                {holders.length === 0 ? <p className="sb-psn-muted">Not open to any account yet.</p> : holders.map(row)}
                <label className="sb-pg-search sb-bz-find">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                  <input
                    type="search"
                    value={bankQ[bank.id] ?? ""}
                    onChange={(e) => setBankQ((m) => ({ ...m, [bank.id]: e.target.value }))}
                    placeholder="Open it for another account…"
                    aria-label={`Find an account to open ${bank.name} for`}
                  />
                </label>
                {candidates.map(row)}
                {find && candidates.length === 0 ? <p className="sb-psn-muted">No other account matches.</p> : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

type PageTab = "banks" | "chains" | "account";

function BusinessPage({
  business: b,
  banks,
  busy,
  error,
  adminId,
  now,
  onBack,
  onSetGrant,
  onChanged,
}: {
  business: Business;
  banks: Bank[];
  busy: string | null;
  error: string | null;
  adminId: string;
  now: number;
  onBack: () => void;
  onSetGrant: (businessId: string, bankId: string, open: boolean, expiresAt: string | null) => Promise<void>;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<PageTab>("banks");
  const [minDay] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)); // the earliest end date: tomorrow
  const chains = b.chains;
  const loose = b.branches.filter((br) => !br.chainId || !chains.some((c) => c.id === br.chainId));

  return (
    <div className="sb-psn sb-bz">
      <div className="sb-psn-head">
        <button type="button" className="sb-psn-back" onClick={onBack} aria-label="Back to accounts">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="sb-psn-backicon"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <span className="sb-pg-avatar sb-psn-avatar" style={{ background: toneFor(b.name) }}>{initialOf(b.name)}</span>
        <div className="sb-psn-title">
          <h2>{b.name}</h2>
          <div className="sb-psn-meta">
            <span><StatusPill status={b.status} /> {b.ownerEmail ?? "No owner"}</span>
            <span>
              {plural(b.branchCount, "branch", "branches")} · {plural(b.devices, "device", "devices")} · {plural(b.users, "user", "users")}
            </span>
          </div>
        </div>
      </div>

      <div className="sb-ph-tabs" role="tablist" aria-label={b.name}>
        <button type="button" role="tab" aria-selected={tab === "banks"} className="sb-ph-tab" onClick={() => setTab("banks")}>Music banks</button>
        <button type="button" role="tab" aria-selected={tab === "chains"} className="sb-ph-tab" onClick={() => setTab("chains")}>Chains &amp; branches</button>
        <button type="button" role="tab" aria-selected={tab === "account"} className="sb-ph-tab" onClick={() => setTab("account")}>Account</button>
      </div>

      {error ? <p className="sb-rh-err" role="alert">{error}</p> : null}

      {tab === "banks" ? (
        <section className="sb-bz-sec" aria-label="Music banks">
          <h3>Private banks</h3>
          <p className="sb-psn-muted">A private bank shows and plays only for the businesses you open it to. Closing it removes it from their catalog and their players stop getting its songs.</p>
          {banks.map((bank) => {
            const g = b.grants.find((x) => x.bankId === bank.id) ?? null;
            const on = g != null && isLive(g);
            const key = `${b.id}:${bank.id}`;
            return (
              <div key={bank.id} className="sb-rh-row sb-rh-row--scope">
                <div className="sb-rh-rowtext">
                  <b>{bank.name}</b>
                  <small>{plural(bank.trackCount, "song", "songs")} · {fmtHours(bank.durationSeconds)}{g && !on ? ` · ended ${fmtDay(g.expiresAt)}` : ""}</small>
                </div>
                <Switch on={on} busy={busy === key} label={`${bank.name} for ${b.name}`} onChange={(next) => void onSetGrant(b.id, bank.id, next, null)} />
                {on && g ? (
                  <div className="sb-bz-until">
                    <span>Open since {fmtDay(g.since)} ·</span>
                    <label>
                      until
                      <input
                        type="date"
                        value={dayInput(g.expiresAt)}
                        min={minDay}
                        disabled={busy === key}
                        onChange={(e) => void onSetGrant(b.id, bank.id, true, e.target.value || null)}
                        aria-label={`End date for ${bank.name}`}
                      />
                    </label>
                    {g.expiresAt ? (
                      <button type="button" className="sb-psn-link" disabled={busy === key} onClick={() => void onSetGrant(b.id, bank.id, true, null)}>No end date</button>
                    ) : (
                      <small>no end date</small>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {tab === "chains" ? (
        <section className="sb-bz-sec" aria-label="Chains and branches">
          {b.branches.length === 0 ? <p className="sb-psn-muted">No branches yet.</p> : null}
          {chains.map((c) => {
            const list = b.branches.filter((br) => br.chainId === c.id);
            if (list.length === 0 && c.isDefault) return null;
            return (
              <div key={c.id} className="sb-bz-chain">
                <h3>
                  <span className="sb-rh-dot" style={{ background: c.color ?? toneFor(c.name) }} aria-hidden />
                  {c.isDefault && chains.length === 1 ? b.name : c.name}
                  <small>{plural(list.length, "branch", "branches")}</small>
                </h3>
                <ul className="sb-bz-branches">
                  {list.map((br) => <li key={br.id}>{br.name}</li>)}
                </ul>
              </div>
            );
          })}
          {loose.length > 0 ? (
            <div className="sb-bz-chain">
              <h3>{chains.length > 0 ? "Other branches" : "Branches"}<small>{plural(loose.length, "branch", "branches")}</small></h3>
              <ul className="sb-bz-branches">
                {loose.map((br) => <li key={br.id}>{br.name}</li>)}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "account" ? (
        <section className="sb-bz-sec" aria-label="Account">
          <dl className="sb-pg-facts sb-bz-facts">
            <div><dt>Owner</dt><dd>{b.ownerEmail ?? "—"}</dd></div>
            <div><dt>Status</dt><dd><StatusPill status={b.status} />{b.overLimit ? <span className="sb-bz-pill sb-bz-overpill" data-tone="warn">Over limit</span> : null}</dd></div>
            {b.suspendedAt ? <div><dt>Suspended</dt><dd>{fmtDay(b.suspendedAt)}{b.suspendedReason ? ` · ${b.suspendedReason}` : ""}</dd></div> : null}
            <div><dt>Plan</dt><dd>{b.plan ?? "No plan"}</dd></div>
            <div><dt>Trial ends</dt><dd>{fmtDay(b.trialEndsAt)}{b.trialEndsAt ? ` · ${fmtUntil(b.trialEndsAt, now)}` : ""}</dd></div>
            <div><dt>Users</dt><dd><Usage used={b.users} max={b.limits?.users} /></dd></div>
            <div><dt>Branches</dt><dd><Usage used={b.branchCount} max={b.limits?.branches} /></dd></div>
            <div><dt>Devices</dt><dd><Usage used={b.devices} max={b.limits?.devices} /></dd></div>
            <div><dt>Playlists</dt><dd><Usage used={b.playlists} max={b.limits?.playlists} /></dd></div>
            <div><dt>Last active</dt><dd>{fmtAgo(b.lastActiveAt, now)}</dd></div>
            <div><dt>Created</dt><dd>{fmtDay(b.createdAt)}</dd></div>
            <div><dt>Id</dt><dd className="sb-bz-mono">{b.slug}</dd></div>
          </dl>
          {/* the same actions as the Platform · Workspaces row (suspend / unsuspend / extend trial, test tear-down) */}
          <div className="sb-bz-actions">
            <WorkspaceActions
              workspaceId={b.id}
              workspaceName={b.name}
              workspaceSlug={b.slug}
              ownerEmail={b.ownerEmail ?? ""}
              status={(b.status ?? null) as "TRIALING" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | null}
              hasEntitlement={b.limits != null}
              trialEndsAtLabel={fmtDay(b.trialEndsAt)}
              trialEndsAtRelative={b.trialEndsAt ? fmtUntil(b.trialEndsAt, now) : ""}
              trialEndsAtIso={b.trialEndsAt}
              onChanged={onChanged}
            />
            {adminId ? (
              <WorkspaceTestDeleteButton
                workspaceId={b.id}
                name={b.name}
                slug={b.slug}
                ownerId={b.ownerId}
                ownerEmail={b.ownerEmail ?? ""}
                adminId={adminId}
                ownerIsSuperAdmin={b.ownerIsSuperAdmin}
              />
            ) : null}
          </div>
          <a className="sb-psn-link sb-bz-full" href={`/admin/platform/workspaces/${encodeURIComponent(b.id)}`}>Open the full admin page (members, devices, limits, log)</a>
        </section>
      ) : null}
    </div>
  );
}
