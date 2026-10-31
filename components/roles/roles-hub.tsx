"use client";

/**
 * ROLES — the Discord-style screen (owner 2026-10-31): a list of the business's roles on one side; the chosen role opens on the other with EVERY permission as an on / off switch, in groups (Access, Player,
 * Library & business, More settings). "More settings" opens the rest: which players and which people the role can see (all / some / none), and editing / adding / removing people. People holding the role are listed
 * at the bottom (a press opens the person's page). Every switch saves at once (the server answer confirms or puts it back). The definition of the permissions lives in lib/role-permissions.ts; WHERE each one is
 * enforced is docs/ROLES_DESIGN.md → "Enforcement map" — this screen only stores the choice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { PERMISSION_GROUPS, PERMISSION_LABELS, ROLE_COLORS, ROLE_SHAPES, normalizePermissions, type PermissionKey, type RoleAppearance, type RolePermissions, type Scope, type ScopeMode } from "@/lib/role-permissions";
import { RoleShapeIcon } from "@/components/roles/role-shape";
import { Toggle } from "@/components/roles/toggle";

export type RoleView = { id: string; name: string; openControlRoom: boolean; allowComputer: boolean; permissions: RolePermissions; members: number };
type PersonLite = { userId: string; name: string; email: string; roleId: string | null };
type BranchLite = { id: string; name: string };

const ERRORS: Record<string, string> = {
  name_taken: "A role with this name already exists.",
  name: "Enter a name for the role.",
  name_long: "The name is too long.",
  too_many_roles: "There are already 20 roles.",
  role_in_use: "People still have this role — change theirs first.",
  bad_code: "The code must be 3–12 letters or digits.",
  permissions: "Something went wrong. Please try again.",
};

function ScopeRow({ title, hint, scope, options, onChange, tr }: { title: string; hint: string; scope: Scope; options: Array<{ id: string; label: string }>; onChange: (s: Scope) => void; tr: (t: string, v?: Record<string, string | number>) => string }) {
  const modes: Array<{ id: ScopeMode; label: string }> = [{ id: "ALL", label: tr("All") }, { id: "SOME", label: tr("Some") }, { id: "NONE", label: tr("None") }];
  return (
    <div className="sb-rh-row sb-rh-row--scope">
      <div className="sb-rh-rowtext"><b>{title}</b><small>{hint}</small></div>
      <div className="sb-rh-seg" role="radiogroup" aria-label={title}>
        {modes.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={scope.mode === m.id} className="sb-rh-segbtn" onClick={() => onChange({ mode: m.id, ids: m.id === "SOME" ? scope.ids : [] })}>{m.label}</button>
        ))}
      </div>
      {scope.mode === "SOME" ? (
        <div className="sb-rh-pick" role="group" aria-label={title}>
          {options.length === 0 ? <small className="sb-rh-note">{tr("Nothing to choose from yet")}</small> : options.map((o) => {
            const on = scope.ids.includes(o.id);
            return (
              <button key={o.id} type="button" className="sb-rh-chip" aria-pressed={on} onClick={() => onChange({ mode: "SOME", ids: on ? scope.ids.filter((x) => x !== o.id) : [...scope.ids, o.id] })}>{o.label}</button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function RolesHub({ roles, customCode, onRolesChange, reload, selectedId, onSelect, onOpenPerson }: {
  roles: RoleView[];
  customCode: boolean;
  onRolesChange: (r: RoleView[]) => void;
  reload: () => Promise<void>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenPerson: (userId: string) => void;
}) {
  const tr = useTr();
  const [people, setPeople] = useState<PersonLite[]>([]);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState("");
  const [lookOpen, setLookOpen] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const t = window.setTimeout(async () => {
      try {
        const [pr, br] = await Promise.all([fetch("/api/people", { credentials: "include", cache: "no-store" }), fetch("/api/branches", { credentials: "include", cache: "no-store" })]);
        const pj = pr.ok ? ((await pr.json()) as { people?: PersonLite[] }) : null;
        const bj = br.ok ? ((await br.json()) as unknown) : null;
        if (!alive.current) return;
        setPeople(pj?.people ?? []);
        setBranches(Array.isArray(bj) ? (bj as BranchLite[]).filter((b) => b && typeof b.id === "string") : []);
      } catch {
        /* the lists of choices stay empty */
      }
    }, 0);
    return () => { alive.current = false; window.clearTimeout(t); };
  }, []);

  const role = roles.find((r) => r.id === selectedId) ?? null;
  const fail = (c?: string) => setError(tr(ERRORS[c ?? ""] ?? "Something went wrong. Please try again."));

  // every change is built on the LATEST version of the role and sent in order — two quick presses never overwrite each other on the server
  const rolesRef = useRef(roles);
  useEffect(() => { rolesRef.current = roles; }, [roles]);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const save = useCallback((r: RoleView, patch: Partial<Pick<RoleView, "name" | "openControlRoom" | "allowComputer" | "permissions">>): void => {
    setError("");
    const cur = rolesRef.current.find((x) => x.id === r.id) ?? r;
    const next = { ...cur, ...patch };
    const updated = rolesRef.current.map((x) => (x.id === r.id ? next : x));
    rolesRef.current = updated;
    onRolesChange(updated); // the switch moves at once; the server answer confirms (or puts it back)
    chain.current = chain.current.then(async () => {
      try {
        const res = await fetch(`/api/roles/${r.id}`, { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: next.name, openControlRoom: next.openControlRoom, allowComputer: next.allowComputer, permissions: next.permissions }) });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(tr(ERRORS[j.error ?? ""] ?? "Something went wrong. Please try again."));
          await reload();
        }
      } catch {
        setError(tr("Something went wrong. Please try again."));
        await reload();
      }
    });
  }, [onRolesChange, reload, tr]);

  const latest = (r: RoleView): RoleView => rolesRef.current.find((x) => x.id === r.id) ?? r;
  const setFlag = (r: RoleView, k: PermissionKey, v: boolean) => { const c = latest(r); save(c, { permissions: normalizePermissions({ ...c.permissions, flags: { ...c.permissions.flags, [k]: v } }, c.name) }); };
  const setLook = (r: RoleView, patch: Partial<RoleAppearance>) => { const c = latest(r); save(c, { permissions: normalizePermissions({ ...c.permissions, appearance: { ...c.permissions.appearance, ...patch } }, c.name) }); };
  const setScope = (r: RoleView, which: "players" | "people", s: Scope) => { const c = latest(r); save(c, { permissions: normalizePermissions({ ...c.permissions, [which]: s }, c.name) }); };

  async function add() {
    const name = newName.trim();
    if (!name) return;
    setError("");
    try {
      const res = await fetch("/api/roles", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, openControlRoom: false, allowComputer: false }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; role?: { id?: string } };
      if (!res.ok) {
        fail(j.error);
        return;
      }
      setNewName("");
      setAdding(false);
      await reload();
      if (j.role?.id) onSelect(j.role.id);
    } catch {
      fail();
    }
  }

  async function remove(r: RoleView) {
    setError("");
    try {
      const res = await fetch(`/api/roles/${r.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        fail(j.error);
        return;
      }
      onSelect(null);
      await reload();
    } catch {
      fail();
    }
  }

  async function saveCode() {
    setError("");
    setSaved("");
    try {
      const res = await fetch("/api/roles/access-code", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        fail(j.error);
        return;
      }
      setCode("");
      setSaved(tr("Saved"));
      await reload();
    } catch {
      fail();
    }
  }

  const members = useMemo(() => (role ? people.filter((p) => p.roleId === role.id) : []), [people, role]);
  const branchOptions = useMemo(() => branches.map((b) => ({ id: b.id, label: b.name })), [branches]);
  const peopleOptions = useMemo(() => people.map((p) => ({ id: p.userId, label: p.name || p.email })), [people]);

  const isOn = (r: RoleView, k: PermissionKey | "openControlRoom" | "allowComputer"): boolean => (k === "openControlRoom" ? r.openControlRoom : k === "allowComputer" ? r.allowComputer : r.permissions.flags[k]);
  const toggle = (r: RoleView, k: PermissionKey | "openControlRoom" | "allowComputer", v: boolean) => (k === "openControlRoom" ? save(r, { openControlRoom: v }) : k === "allowComputer" ? save(r, { allowComputer: v }) : setFlag(r, k, v));

  return (
    <div className="sb-rh">
      <aside className="sb-rh-list" aria-label={tr("Roles")}>
        <div className="sb-rh-listhead">
          <b>{tr("Roles")}</b>
          <button type="button" className="sb-rh-add" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>+ {tr("New role")}</button>
        </div>
        {adding ? (
          <form className="sb-rh-newform" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={tr("Role name")} maxLength={40} aria-label={tr("Role name")} autoFocus />
            <button type="submit" disabled={!newName.trim()}>{tr("Add")}</button>
          </form>
        ) : null}
        <ul className="sb-rh-items">
          {roles.map((r) => (
            <li key={r.id}>
              <button type="button" className="sb-rh-item" aria-current={r.id === selectedId ? "true" : undefined} onClick={() => onSelect(r.id)}>
                <RoleShapeIcon look={r.permissions.appearance} size={18} />
                <span className="sb-rh-itemname">{r.name}</span>
                <small>{r.members}</small>
              </button>
            </li>
          ))}
        </ul>
        <div className="sb-rh-code">
          <b>{tr("Access code for Settings on the player computer")}</b>
          <form onSubmit={(e) => { e.preventDefault(); void saveCode(); }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={12} placeholder={customCode ? "••••" : "123"} dir="ltr" aria-label={tr("Access code")} />
            <button type="submit" disabled={code.trim().length < 3}>{tr("Save")}</button>
          </form>
          {saved ? <small className="sb-rh-ok">{saved}</small> : null}
        </div>
      </aside>

      <section className="sb-rh-edit" aria-label={role ? role.name : tr("Role")}>
        {!role ? (
          <p className="sb-rh-empty">{tr("Choose a role to see what it may do.")}</p>
        ) : (
          <>
            <div className="sb-rh-head">
              <button type="button" className="sb-rh-look" aria-expanded={lookOpen} aria-label={tr("Shape and colour")} onClick={() => setLookOpen((v) => !v)}><RoleShapeIcon look={role.permissions.appearance} size={26} /></button>
              <input key={role.id + role.name} className="sb-rh-name" defaultValue={role.name} maxLength={40} aria-label={tr("Role name")} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== role.name) save(role, { name: v }); else e.target.value = role.name; }} />
              <button type="button" className="sb-rh-del" disabled={role.members > 0} title={role.members > 0 ? tr("People still have this role — change theirs first.") : undefined} onClick={() => void remove(role)}>{tr("Delete role")}</button>
            </div>

            {lookOpen ? (
              <div className="sb-rh-lookpick" role="group" aria-label={tr("Shape and colour")}>
                <div className="sb-rh-shapes">
                  {ROLE_SHAPES.map((sh) => (
                    <button key={sh} type="button" className="sb-rh-shape" aria-pressed={role.permissions.appearance.shape === sh} aria-label={sh} onClick={() => setLook(role, { shape: sh })}><RoleShapeIcon look={{ shape: sh, color: role.permissions.appearance.color }} size={22} /></button>
                  ))}
                </div>
                <div className="sb-rh-colors">
                  {ROLE_COLORS.map((c) => (
                    <button key={c} type="button" className="sb-rh-color" aria-pressed={role.permissions.appearance.color === c} aria-label={c} style={{ background: c }} onClick={() => setLook(role, { color: c })} />
                  ))}
                </div>
              </div>
            ) : null}

            <div className="sb-rh-groups">
            {PERMISSION_GROUPS.map((g) => (
              <div key={g.id} className="sb-rh-group">
                <h3>{tr(g.title)}</h3>
                {g.hint ? <p className="sb-rh-grouphint">{tr(g.hint)}</p> : null}
                {g.keys.map((k) => {
                  const more = g.id === "more" && k !== "more_settings";
                  if (more && !role.permissions.flags.more_settings) return null;
                  return (
                    <div key={k}>
                      {g.id === "more" && k === "edit_people" ? (
                        <>
                          <ScopeRow title={tr("Players they can see and control")} hint={tr("All players, only some of them, or none.")} scope={role.permissions.players} options={branchOptions} onChange={(s) => setScope(role, "players", s)} tr={tr} />
                          <ScopeRow title={tr("People they can see")} hint={tr("Everyone in the business, only some people, or nobody.")} scope={role.permissions.people} options={peopleOptions} onChange={(s) => setScope(role, "people", s)} tr={tr} />
                        </>
                      ) : null}
                      <div className="sb-rh-row">
                        <div className="sb-rh-rowtext"><b>{tr(PERMISSION_LABELS[k].title)}</b><small>{tr(PERMISSION_LABELS[k].hint)}</small></div>
                        <Toggle on={isOn(role, k)} onChange={(v) => toggle(role, k, v)} label={tr(PERMISSION_LABELS[k].title)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="sb-rh-group">
              <h3>{tr("People with this role")} <small>{members.length}</small></h3>
              {members.length === 0 ? <p className="sb-rh-grouphint">{tr("Nobody has this role yet.")}</p> : (
                <div className="sb-rh-members">
                  {members.map((m) => <button key={m.userId} type="button" className="sb-rh-chip" onClick={() => onOpenPerson(m.userId)}>{m.name || m.email}</button>)}
                </div>
              )}
            </div>
            </div>
          </>
        )}
        {error ? <p className="sb-rh-err" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
