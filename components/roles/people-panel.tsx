"use client";

/**
 * "People" — the Permissions screen's list of everyone in the business (owner 2026-10-29): name, level, state and last sign-in; click a person to open their details and give them another of the
 * owner's roles. Frameless rows. The role picker appears only when roles are on (SYNCBIZ_ROLES=1); the list itself reads existing data.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";

type Person = { userId: string; name: string; email: string; level: "owner" | "manager" | "member"; roleId: string | null; roleName: string | null; status: "active" | "paused" | "disabled"; lastSignInAt: string | null; joinedAt: string; isYou: boolean };
type Role = { id: string; name: string };

const ERRORS: Record<string, string> = {
  not_yourself: "You cannot change your own role.",
  protected_member: "The owner and workspace admins keep their level.",
  role_not_found: "That role no longer exists.",
};

function ago(iso: string | null, tr: (t: string, v?: Record<string, string | number>) => string): string {
  if (!iso) return tr("Never signed in");
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 2) return tr("Just now");
  if (min < 60) return tr("{n} min ago", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return tr("{n} h ago", { n: h });
  return tr("{n} days ago", { n: Math.round(h / 24) });
}

export function PeoplePanel() {
  const tr = useTr();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/people", { credentials: "include", cache: "no-store" });
      if (!r.ok) return; // not an admin: stay hidden
      const j = (await r.json()) as { people?: Person[] };
      let rolesList: Role[] = [];
      try {
        const rr = await fetch("/api/roles", { credentials: "include", cache: "no-store" });
        const rj = rr.ok ? ((await rr.json()) as { enabled?: boolean; roles?: Role[] }) : null;
        if (rj?.enabled) rolesList = rj.roles ?? [];
      } catch {
        /* no roles: the list is read-only */
      }
      if (!alive.current) return;
      setPeople(j.people ?? []);
      setRoles(rolesList);
    } catch {
      /* offline — keep what is shown */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => void load(), 0);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      window.clearTimeout(first);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  async function setRole(p: Person, roleId: string) {
    setError("");
    try {
      const r = await fetch(`/api/people/${p.userId}/role`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ roleId }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setError(tr(ERRORS[j.error ?? ""] ?? "Something went wrong. Please try again."));
      }
      await load();
    } catch {
      setError(tr("Something went wrong. Please try again."));
    }
  }

  if (people === null || people.length === 0) return null;
  const levelLabel = (p: Person) => (p.level === "owner" ? tr("Owner") : p.level === "manager" ? tr("Manager") : tr("Member"));
  const statusLabel = (p: Person) => (p.status === "active" ? tr("Active") : p.status === "paused" ? tr("Paused") : tr("Disabled"));

  return (
    <section className="mb-5 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5" aria-label={tr("People")}>
      <h2 className="text-sm font-semibold tracking-tight">{tr("People")}</h2>
      <ul className="mt-2 divide-y divide-white/5">
        {people.map((p) => {
          const isOpen = open === p.userId;
          return (
            <li key={p.userId}>
              <button type="button" onClick={() => setOpen(isOpen ? null : p.userId)} aria-expanded={isOpen} className="flex w-full items-center gap-3 py-3 text-start transition hover:bg-white/[0.03]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${p.status === "active" ? "bg-emerald-400" : "bg-slate-500"}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">{p.name}{p.isYou ? ` · ${tr("You")}` : ""}</span>
                  <span className="block truncate text-xs text-slate-400"><span dir="ltr" style={{ display: "inline-block" }}>{p.email}</span></span>
                </span>
                <span className="shrink-0 text-xs text-slate-300">{p.roleName ?? levelLabel(p)}</span>
                <span className="hidden w-[110px] shrink-0 text-end text-[11px] text-slate-500 sm:block">{ago(p.lastSignInAt, tr)}</span>
              </button>
              {isOpen ? (
                <div className="grid gap-x-8 gap-y-3 pb-4 ps-5 text-xs text-slate-300 sm:grid-cols-2">
                  <div><div className="text-slate-500">{tr("E-mail")}</div><div className="mt-0.5"><span dir="ltr" style={{ display: "inline-block" }}>{p.email}</span></div></div>
                  <div><div className="text-slate-500">{tr("Level")}</div><div className="mt-0.5">{levelLabel(p)}</div></div>
                  <div><div className="text-slate-500">{tr("State")}</div><div className="mt-0.5">{statusLabel(p)}</div></div>
                  <div><div className="text-slate-500">{tr("Last sign-in")}</div><div className="mt-0.5">{ago(p.lastSignInAt, tr)}</div></div>
                  <div><div className="text-slate-500">{tr("Joined")}</div><div className="mt-0.5">{new Date(p.joinedAt).toLocaleDateString()}</div></div>
                  {roles.length > 0 ? (
                    <div>
                      <div className="text-slate-500">{tr("Role")}</div>
                      {p.level === "owner" || p.isYou ? (
                        <div className="mt-0.5">{p.roleName ?? levelLabel(p)}</div>
                      ) : (
                        <select value={p.roleId ?? ""} onChange={(e) => e.target.value && void setRole(p, e.target.value)} aria-label={tr("Role")} className="mt-1 rounded-full border-0 bg-white/10 px-3 py-1.5 text-xs text-white outline-none">
                          {p.roleId ? null : <option value="" className="text-slate-900">—</option>}
                          {roles.map((o) => <option key={o.id} value={o.id} className="text-slate-900">{o.name}</option>)}
                        </select>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-2 text-xs text-red-400" role="alert">{error}</p> : null}
    </section>
  );
}
