"use client";

/**
 * Platform → BUSINESSES (owner 2026-11-10): "the permissions room's design, only businesses instead of people — chains under
 * them — and every one with tidy tabs". Squares, one per business (the same glass tiles as People); a press opens the business's
 * own page with tabs: Music banks (open / close a PRIVATE bank, optional end date), Chains & branches, Account. A second top tab,
 * Music banks, shows each private bank with a switch per business. SUPER_ADMIN only (the data routes answer 403 to anyone else).
 * Styles: the permissions room's own classes (people-grid.css, permissions-hub.css) + businesses-hub.css for the few new pieces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import "@/components/roles/people-grid.css";
import "@/components/roles/permissions-hub.css";
import "@/components/admin/businesses-hub.css";

type Bank = { id: string; name: string; description: string; trackCount: number; durationSeconds: number };
type Grant = { bankId: string; expiresAt: string | null; since: string };
type Business = {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string | null;
  createdAt: string;
  status: string | null;
  plan: string | null;
  trialEndsAt: string | null;
  users: number;
  branchCount: number;
  devices: number;
  chains: { id: string; name: string; isDefault: boolean; color: string | null }[];
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
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/platform/music-banks", { credentials: "include", cache: "no-store" });
      if (!r.ok) {
        setError(r.status === 403 ? "Only the platform owner can open this page." : "Could not load the businesses.");
        return;
      }
      const j = (await r.json()) as { banks: Bank[]; businesses: Business[] };
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

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = businesses ?? [];
    if (!n) return list;
    return list.filter((b) => [b.name, b.slug, b.ownerEmail ?? "", ...b.chains.map((c) => c.name)].some((s) => s.toLowerCase().includes(n)));
  }, [businesses, q]);

  const open = openId ? (businesses ?? []).find((b) => b.id === openId) ?? null : null;
  if (open) {
    return <BusinessPage business={open} banks={banks} busy={busy} error={error} onBack={() => setOpenId(null)} onSetGrant={setGrant} />;
  }

  return (
    <div className="sb-ph sb-bz">
      <div className="sb-ph-tabs" role="tablist" aria-label="Businesses">
        <button type="button" role="tab" aria-selected={tab === "businesses"} className="sb-ph-tab" onClick={() => setTab("businesses")}>Businesses</button>
        <button type="button" role="tab" aria-selected={tab === "banks"} className="sb-ph-tab" onClick={() => setTab("banks")}>Music banks</button>
      </div>

      {error ? <p className="sb-rh-err" role="alert">{error}</p> : null}
      {businesses === null && !error ? <p className="sb-rh-empty">Loading…</p> : null}

      {businesses !== null && tab === "businesses" ? (
        <section className="sb-pg" aria-label="Businesses">
          <div className="sb-pg-top">
            <h2 className="sb-pg-title">Businesses <small className="sb-bz-count">{businesses.length}</small></h2>
            <label className="sb-pg-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Business, chain or owner email" aria-label="Search businesses" />
            </label>
          </div>
          <div className="sb-pg-grid">
            {shown.map((b) => {
              const live = b.grants.filter(isLive).length;
              const chains = b.chains.filter((c) => !c.isDefault);
              return (
                <button key={b.id} type="button" className="sb-pg-tile" onClick={() => setOpenId(b.id)}>
                  {live > 0 ? <span className="sb-pg-dot" aria-hidden title="Has private banks" /> : null}
                  <span className="sb-pg-avatar" style={{ background: toneFor(b.name) }}>{initialOf(b.name)}</span>
                  <span className="sb-pg-name">{b.name}</span>
                  <span className="sb-pg-sub">
                    {chains.length > 0 ? plural(chains.length, "chain", "chains") + " · " : ""}
                    {plural(b.branchCount, "branch", "branches")}
                  </span>
                  {live > 0 ? <span className="sb-pg-sub sb-bz-banks">{plural(live, "private bank", "private banks")}</span> : null}
                </button>
              );
            })}
            {q && shown.length === 0 ? <p className="sb-pg-empty">No business matches.</p> : null}
          </div>
        </section>
      ) : null}

      {businesses !== null && tab === "banks" ? (
        <section className="sb-bz-banks-tab" aria-label="Music banks">
          {banks.map((bank) => {
            const holders = businesses.filter((b) => b.grants.some((g) => g.bankId === bank.id && isLive(g))).length;
            return (
              <div key={bank.id} className="sb-bz-bank">
                <div className="sb-rh-head">
                  <span className="sb-bz-bankicon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
                  </span>
                  <div className="sb-rh-rowtext">
                    <b className="sb-bz-bankname">{bank.name}</b>
                    <small>Private · {plural(bank.trackCount, "song", "songs")} · {fmtHours(bank.durationSeconds)} · open to {plural(holders, "business", "businesses")}</small>
                  </div>
                </div>
                <p className="sb-rh-grouphint">{bank.description}</p>
                {businesses.map((b) => {
                  const g = b.grants.find((x) => x.bankId === bank.id) ?? null;
                  const on = g != null && isLive(g);
                  return (
                    <div key={b.id} className="sb-rh-row">
                      <span className="sb-pg-avatar sb-bz-mini" style={{ background: toneFor(b.name) }}>{initialOf(b.name)}</span>
                      <div className="sb-rh-rowtext">
                        <b>{b.name}</b>
                        <small>{g ? (on ? (g.expiresAt ? `Open until ${fmtDay(g.expiresAt)}` : "Open · no end date") : `Ended ${fmtDay(g.expiresAt)}`) : "Closed"}</small>
                      </div>
                      <Switch on={on} busy={busy === `${b.id}:${bank.id}`} label={`${bank.name} for ${b.name}`} onChange={(next) => void setGrant(b.id, bank.id, next, null)} />
                    </div>
                  );
                })}
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
  onBack,
  onSetGrant,
}: {
  business: Business;
  banks: Bank[];
  busy: string | null;
  error: string | null;
  onBack: () => void;
  onSetGrant: (businessId: string, bankId: string, open: boolean, expiresAt: string | null) => Promise<void>;
}) {
  const [tab, setTab] = useState<PageTab>("banks");
  const [minDay] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)); // the earliest end date: tomorrow
  const chains = b.chains;
  const loose = b.branches.filter((br) => !br.chainId || !chains.some((c) => c.id === br.chainId));

  return (
    <div className="sb-psn sb-bz">
      <div className="sb-psn-head">
        <button type="button" className="sb-psn-back" onClick={onBack} aria-label="Back to businesses">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="sb-psn-backicon"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <span className="sb-pg-avatar sb-psn-avatar" style={{ background: toneFor(b.name) }}>{initialOf(b.name)}</span>
        <div className="sb-psn-title">
          <h2>{b.name}</h2>
          <div className="sb-psn-meta">
            <span>{b.ownerEmail ?? "No owner"}</span>
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
            <div><dt>Status</dt><dd>{b.status ?? "—"}</dd></div>
            <div><dt>Plan</dt><dd>{b.plan ?? "—"}</dd></div>
            <div><dt>Trial ends</dt><dd>{fmtDay(b.trialEndsAt)}</dd></div>
            <div><dt>Users</dt><dd>{b.users}</dd></div>
            <div><dt>Branches</dt><dd>{b.branchCount}</dd></div>
            <div><dt>Devices</dt><dd>{b.devices}</dd></div>
            <div><dt>Created</dt><dd>{fmtDay(b.createdAt)}</dd></div>
            <div><dt>Id</dt><dd className="sb-bz-mono">{b.slug}</dd></div>
          </dl>
          <a className="sb-psn-link sb-bz-full" href={`/admin/platform/workspaces/${encodeURIComponent(b.id)}`}>Open the full admin page (members, devices, limits, log)</a>
        </section>
      ) : null}
    </div>
  );
}
