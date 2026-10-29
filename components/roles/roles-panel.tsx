"use client";

/**
 * "Roles" — the owner defines the roles of his business and their switches (docs/ROLES_DESIGN.md), and chooses his own access code for Settings on the player computer.
 * Shown at the top of Access Control; draws NOTHING unless SYNCBIZ_ROLES=1 and the caller is a workspace admin (a flag-off server answers `enabled:false`).
 * Only switches that are enforced are offered: "opens the Control Room" and "may sign in from a computer".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";

type Role = { id: string; name: string; openControlRoom: boolean; allowComputer: boolean; members: number };

const ERRORS: Record<string, string> = {
  name_taken: "A role with this name already exists.",
  name: "Enter a name for the role.",
  name_long: "The name is too long.",
  too_many_roles: "There are already 20 roles.",
  role_in_use: "People still have this role — change theirs first.",
  bad_code: "The code must be 3–12 letters or digits.",
};

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className={`relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors ${on ? "bg-emerald-400/90" : "bg-white/20"}`}>
      <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all ${on ? "start-[20px]" : "start-[2px]"}`} />
    </button>
  );
}

export function RolesPanel() {
  const tr = useTr();
  const [enabled, setEnabled] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [customCode, setCustomCode] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [newName, setNewName] = useState("");
  const [code, setCode] = useState("");
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/roles", { credentials: "include", cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { enabled?: boolean; roles?: Role[]; customCode?: boolean };
      if (!alive.current) return;
      setEnabled(Boolean(j.enabled));
      setRoles(j.roles ?? []);
      setCustomCode(Boolean(j.customCode));
    } catch {
      /* offline — keep what is shown */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(() => void load(), 0);
    const onFocus = () => void load(); // another admin may have changed something
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      window.clearTimeout(first);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const fail = (code?: string) => setError(tr(ERRORS[code ?? ""] ?? "Something went wrong. Please try again."));

  async function save(role: Role, patch: Partial<Pick<Role, "name" | "openControlRoom" | "allowComputer">>) {
    setError("");
    const next = { ...role, ...patch };
    setRoles((rs) => rs.map((x) => (x.id === role.id ? next : x))); // the switch moves at once; the server answer confirms (or puts it back)
    try {
      const r = await fetch(`/api/roles/${role.id}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: next.name, openControlRoom: next.openControlRoom, allowComputer: next.allowComputer }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        fail(j.error);
        await load();
      }
    } catch {
      fail();
      await load();
    }
  }

  async function add() {
    if (!newName.trim()) return;
    setError("");
    try {
      const r = await fetch("/api/roles", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newName, openControlRoom: false, allowComputer: true }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        fail(j.error);
        return;
      }
      setNewName("");
      await load();
    } catch {
      fail();
    }
  }

  async function remove(role: Role) {
    setError("");
    try {
      const r = await fetch(`/api/roles/${role.id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        fail(j.error);
        return;
      }
      await load();
    } catch {
      fail();
    }
  }

  async function saveCode() {
    setError("");
    setSaved("");
    try {
      const r = await fetch("/api/roles/access-code", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        fail(j.error);
        return;
      }
      setCode("");
      setSaved(tr("Saved"));
      await load();
    } catch {
      fail();
    }
  }

  if (!enabled) return null;

  return (
    <section className="mb-5 rounded-2xl border border-slate-800/80 bg-slate-950/50 p-5" aria-label={tr("Roles")}>
      <h2 className="text-sm font-semibold tracking-tight">{tr("Roles")}</h2>

      <div className="mt-3 hidden items-center gap-4 px-1 text-[11px] text-slate-500 sm:flex">
        <span className="min-w-0 flex-1">{tr("Role")}</span>
        <span className="w-[120px] text-center">{tr("Opens the Control Room")}</span>
        <span className="w-[120px] text-center">{tr("May sign in from a computer")}</span>
        <span className="w-[56px]" />
      </div>
      <ul className="divide-y divide-white/5">
        {roles.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
            <input
              defaultValue={r.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== r.name) void save(r, { name: v });
                else e.target.value = r.name;
              }}
              aria-label={tr("Role")}
              className="min-w-0 flex-1 rounded-lg bg-transparent px-1 py-1 text-sm font-medium text-white outline-none focus:bg-white/10"
            />
            <span className="flex w-[120px] items-center justify-center"><Switch on={r.openControlRoom} onChange={(v) => void save(r, { openControlRoom: v })} label={tr("Opens the Control Room")} /></span>
            <span className="flex w-[120px] items-center justify-center"><Switch on={r.allowComputer} onChange={(v) => void save(r, { allowComputer: v })} label={tr("May sign in from a computer")} /></span>
            <span className="flex w-[56px] justify-end">
              <button type="button" onClick={() => void remove(r)} className="text-xs text-slate-400 underline-offset-4 hover:text-white hover:underline" title={r.members > 0 ? tr("People still have this role — change theirs first.") : undefined}>
                {tr("Delete")}
              </button>
            </span>
          </li>
        ))}
      </ul>

      <form className="mt-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={tr("New role")} maxLength={40} className="min-w-0 flex-1 rounded-full border-0 bg-white/10 px-4 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:bg-white/15" />
        <button type="submit" disabled={!newName.trim()} className="rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-50">{tr("Add")}</button>
      </form>

      <div className="mt-5 border-t border-white/5 pt-4">
        <div className="text-xs font-medium text-slate-400">{tr("Access code for Settings on the player computer")}</div>
        <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void saveCode(); }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={12} placeholder={customCode ? "••••" : "123"} dir="ltr" aria-label={tr("Access code")} className="w-40 rounded-full border-0 bg-white/10 px-4 py-2 text-center text-sm tracking-widest text-white outline-none placeholder:text-slate-500 focus:bg-white/15" />
          <button type="submit" disabled={code.trim().length < 3} className="rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:opacity-50">{tr("Save")}</button>
          {saved ? <span className="text-xs text-emerald-300">{saved}</span> : null}
        </form>
      </div>
      {error ? <p className="mt-3 text-xs text-red-400" role="alert">{error}</p> : null}
    </section>
  );
}
