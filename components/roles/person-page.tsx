"use client";

/**
 * A PERSON — a full page, like a branch's page without the map (owner 2026-10-31): a way back arrow beside the name, the person's details below it, then every control over them: which ROLE they hold (and what
 * that role allows), which BRANCHES they can reach (control from afar / see), and the account itself (pause / resume sign-in, remove). The branch choice here is the person's own scope; whether they may open a
 * branch's SETTINGS or only control it is a permission of their role. Reads /api/people, /api/admin/users and /api/branches; writes through the same routes the old console used (workspace admin only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { ALL_FLAG_KEYS, PERMISSION_LABELS } from "@/lib/role-permissions";
import { roleDot, type RoleView } from "@/components/roles/roles-hub";
import "@/components/roles/people-grid.css";

type Person = { userId: string; name: string; email: string; level: "owner" | "manager" | "member"; roleId: string | null; roleName: string | null; status: "active" | "paused" | "disabled"; lastSignInAt: string | null; joinedAt: string; isYou: boolean };
type ApiUser = { id: string; email: string; accessType: "OWNER" | "BRANCH_USER"; branchIds: string[]; canRemoveFromWorkspace?: boolean; canPauseInWorkspace?: boolean; protected?: boolean };
type Branch = { id: string; name: string; city?: string };

const TONES = ["#2f9e8f", "#4c6ef5", "#9c5de4", "#d9730d", "#d6336c", "#3b8f4a", "#c2874a", "#5a7fa8"];
const toneFor = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
};

export function PersonPage({ userId, roles, onBack, onEditRole }: { userId: string; roles: RoleView[]; onBack: () => void; onEditRole: (roleId: string) => void }) {
  const tr = useTr();
  const [person, setPerson] = useState<Person | null | undefined>(undefined);
  const [account, setAccount] = useState<ApiUser | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const [pr, ar, br] = await Promise.all([
        fetch("/api/people", { credentials: "include", cache: "no-store" }),
        fetch("/api/admin/users", { credentials: "include", cache: "no-store" }),
        fetch("/api/branches", { credentials: "include", cache: "no-store" }),
      ]);
      const people = pr.ok ? (((await pr.json()) as { people?: Person[] }).people ?? []) : [];
      const me = people.find((p) => p.userId === userId) ?? null;
      const users = ar.ok ? ((await ar.json()) as ApiUser[]) : [];
      const acc = Array.isArray(users) && me ? users.find((u) => u.email.toLowerCase() === me.email.toLowerCase()) ?? null : null;
      const bj = br.ok ? ((await br.json()) as unknown) : [];
      if (!alive.current) return;
      setPerson(me);
      setAccount(acc);
      setBranches(Array.isArray(bj) ? (bj as Branch[]).filter((b) => b && typeof b.id === "string") : []);
      setPicked(acc?.accessType === "BRANCH_USER" ? acc.branchIds : []);
    } catch {
      if (alive.current) setPerson((p) => (p === undefined ? null : p));
    }
  }, [userId]);

  useEffect(() => {
    alive.current = true;
    const t = window.setTimeout(() => void load(), 0);
    return () => { alive.current = false; window.clearTimeout(t); };
  }, [load]);

  const role = useMemo(() => roles.find((r) => r.id === person?.roleId) ?? null, [roles, person?.roleId]);
  const allowed = useMemo(() => (role ? ALL_FLAG_KEYS.filter((k) => role.permissions.flags[k]) : []), [role]);

  const fail = (code?: string) => setError(tr(code === "not_yourself" ? "You cannot change your own role." : code === "protected" ? "The owner and workspace admins keep their level." : "Something went wrong. Please try again."));

  async function give(roleId: string) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = await fetch(`/api/people/${userId}/role`, { method: "PUT", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ roleId }) });
      if (!r.ok) {
        fail(((await r.json().catch(() => ({}))) as { error?: string }).error);
        return;
      }
      setNote(tr("Saved"));
      await load();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  async function saveBranches(ids: string[]) {
    if (!person || ids.length === 0) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = await fetch("/api/admin/users", { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: person.email, accessType: "BRANCH_USER", branchIds: ids }) });
      if (!r.ok) {
        fail();
        return;
      }
      setNote(tr("Saved"));
      await load();
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }

  async function account_(action: "pause-member" | "resume-member" | "remove-member") {
    if (!person) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const r = await fetch(`/api/admin/users/${action}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: person.email }) });
      if (!r.ok) {
        fail();
        return;
      }
      if (action === "remove-member") {
        onBack();
        return;
      }
      setNote(tr("Saved"));
      await load();
    } catch {
      fail();
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  }

  const back = (
    <button type="button" className="sb-psn-back" onClick={onBack} aria-label={tr("Back")}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="sb-psn-backicon"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
  );
  if (person === undefined) return <div className="sb-psn">{back}</div>;
  if (person === null) return <div className="sb-psn"><div className="sb-psn-head">{back}<b>{tr("This person was not found.")}</b></div></div>;

  const levelText = person.level === "owner" ? tr("Owner") : person.level === "manager" ? tr("Manager") : tr("Member");
  const stateText = person.status === "active" ? tr("Active") : person.status === "paused" ? tr("Paused") : tr("Sign-in off");
  const isAdminLevel = person.level !== "member" || account?.accessType === "OWNER";
  const allIds = branches.map((b) => b.id);
  const allPicked = allIds.length > 0 && allIds.every((id) => picked.includes(id));
  const dirty = account?.accessType === "BRANCH_USER" && (picked.length !== account.branchIds.length || picked.some((id) => !account.branchIds.includes(id)));

  return (
    <div className="sb-psn">
      <div className="sb-psn-head">
        {back}
        <span className="sb-pg-avatar sb-psn-avatar" style={{ background: toneFor(person.name || person.email) }}>{(person.name || person.email).trim()[0]?.toUpperCase() ?? "?"}</span>
        <div className="sb-psn-title">
          <h2>{person.name || person.email}{person.isYou ? <small> · {tr("You")}</small> : null}</h2>
          <span>{levelText} · {stateText}</span>
        </div>
      </div>

      <div className="sb-psn-grid">
        <section className="sb-psn-card" aria-label={tr("Details")}>
          <h3>{tr("Details")}</h3>
          <dl className="sb-psn-facts">
            <div><dt>{tr("E-mail")}</dt><dd dir="ltr">{person.email}</dd></div>
            <div><dt>{tr("Level")}</dt><dd>{levelText}</dd></div>
            <div><dt>{tr("State")}</dt><dd>{stateText}</dd></div>
            <div><dt>{tr("Last sign-in")}</dt><dd>{person.lastSignInAt ? new Date(person.lastSignInAt).toLocaleString() : tr("Never signed in")}</dd></div>
            <div><dt>{tr("Joined")}</dt><dd>{new Date(person.joinedAt).toLocaleDateString()}</dd></div>
          </dl>
        </section>

        <section className="sb-psn-card" aria-label={tr("Role")}>
          <h3>{tr("Role")}</h3>
          {roles.length === 0 ? <p className="sb-psn-muted">{tr("Roles are not switched on for this business.")}</p> : isAdminLevel ? <p className="sb-psn-muted">{tr("The owner and managers keep their level — it is not changed with a role.")}</p> : (
            <>
              <div className="sb-psn-roles" role="radiogroup" aria-label={tr("Role")}>
                {roles.map((r) => (
                  <button key={r.id} type="button" role="radio" aria-checked={person.roleId === r.id} className="sb-psn-role" disabled={busy || person.isYou} onClick={() => void give(r.id)}>
                    <i className="sb-rh-dot" style={{ background: roleDot(r.name) }} aria-hidden />{r.name}
                  </button>
                ))}
              </div>
              {role ? (
                <>
                  <p className="sb-psn-muted">{allowed.length === 0 ? tr("This role allows nothing yet.") : tr("This role allows:")}</p>
                  <div className="sb-psn-allowed">
                    {allowed.map((k) => <span key={k} className="sb-psn-tag">{tr(PERMISSION_LABELS[k].title)}</span>)}
                    <span className="sb-psn-tag sb-psn-tag--q" data-on={role.permissions.flags.branch_settings ? "1" : "0"}>{role.permissions.flags.branch_settings ? tr("Can open a branch's settings") : tr("Controls from afar only — no branch settings")}</span>
                  </div>
                  <button type="button" className="sb-psn-link" onClick={() => onEditRole(role.id)}>{tr("Edit this role")}</button>
                </>
              ) : null}
            </>
          )}
        </section>

        <section className="sb-psn-card" aria-label={tr("Branches")}>
          <h3>{tr("Branches")}</h3>
          {isAdminLevel ? <p className="sb-psn-muted">{tr("Full access to every branch.")}</p> : (
            <>
              <p className="sb-psn-muted">{tr("The branches this person can reach — to control from afar or to see.")}</p>
              <div className="sb-psn-segrow">
                <button type="button" className="sb-rh-segbtn" aria-pressed={allPicked} onClick={() => setPicked(allIds)}>{tr("All branches")}</button>
                <button type="button" className="sb-rh-segbtn" aria-pressed={!allPicked} onClick={() => setPicked(picked.length === allIds.length ? picked.slice(0, 1) : picked)}>{tr("Selected branches")}</button>
              </div>
              <div className="sb-rh-pick">
                {branches.map((b) => {
                  const on = picked.includes(b.id);
                  return <button key={b.id} type="button" className="sb-rh-chip" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== b.id) : [...picked, b.id])}>{b.name}</button>;
                })}
              </div>
              <button type="button" className="sb-psn-save" disabled={busy || !dirty || picked.length === 0} onClick={() => void saveBranches(picked)}>{tr("Save branches")}</button>
              {picked.length === 0 ? <small className="sb-psn-muted">{tr("Choose at least one branch.")}</small> : null}
            </>
          )}
        </section>

        {account && !person.isYou && person.level !== "owner" ? (
          <section className="sb-psn-card" aria-label={tr("Account")}>
            <h3>{tr("Account")}</h3>
            <div className="sb-psn-actions">
              {account.canPauseInWorkspace !== false ? (
                person.status === "paused" ? <button type="button" className="sb-pg-btn" disabled={busy} onClick={() => void account_("resume-member")}>{tr("Let them sign in again")}</button> : <button type="button" className="sb-pg-btn" disabled={busy} onClick={() => void account_("pause-member")}>{tr("Pause sign-in")}</button>
              ) : null}
              {account.canRemoveFromWorkspace !== false ? (
                confirmRemove ? <button type="button" className="sb-pg-btn sb-psn-danger" disabled={busy} onClick={() => void account_("remove-member")}>{tr("Press again to remove")}</button> : <button type="button" className="sb-pg-btn" disabled={busy} onClick={() => setConfirmRemove(true)}>{tr("Remove from the business")}</button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
      {note ? <p className="sb-psn-ok" role="status">{note}</p> : null}
      {error ? <p className="sb-pg-err" role="alert">{error}</p> : null}
    </div>
  );
}
