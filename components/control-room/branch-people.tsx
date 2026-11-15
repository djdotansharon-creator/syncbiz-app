"use client";

/**
 * CONTROL ROOM — the PEOPLE of one branch (owner 2026-11-15): on the branch screen, next to the player and its remotes, up to four people of the
 * branch as round discs (the first letter, a name, the role) and "See more", which opens the whole screen of the people under the branch.
 *
 * Display only — it changes nobody's access and sends nothing. The data is what the Permissions screen already reads: /api/people (name, level,
 * role, state, last sign-in) joined to /api/admin/users (which branches a person reaches). Both are for a workspace admin; for anyone else the
 * section simply does not appear (the same rule as the People screen). Owners and managers reach every branch, so they are listed apart.
 */

import Link from "next/link";
import { useEffect, useState, type ReactElement } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { initialOf } from "@/lib/initial-of";
import { splitBranchPeople } from "@/lib/branch-people";
import "./branch-people.css";

export type BranchPerson = {
  userId: string;
  name: string;
  email: string;
  /** the custom role's name when roles are on, otherwise the level ("Owner" / "Manager" / "Member") — resolved on screen */
  roleName: string | null;
  level: "owner" | "manager" | "member";
  status: "active" | "paused" | "disabled";
  lastSignInAt: string | null;
  isYou: boolean;
};

type PeopleReply = { people?: Array<BranchPerson> };
type AccountRow = { email: string; accessType: "OWNER" | "BRANCH_USER"; branchIds: string[] };
type Loaded = { people: BranchPerson[]; accounts: AccountRow[] };

const SHARE_MS = 15_000;
let shared: { at: number; value: Promise<Loaded | null> } | null = null;
/** one pair of reads shared by the strip and the full screen (and by a quick re-open); null = not an admin / not reachable → show nothing */
function loadPeople(force = false): Promise<Loaded | null> {
  if (!force && shared && Date.now() - shared.at < SHARE_MS) return shared.value;
  const value = (async (): Promise<Loaded | null> => {
    try {
      const [pr, ar] = await Promise.all([
        fetch("/api/people", { credentials: "include", cache: "no-store" }),
        fetch("/api/admin/users", { credentials: "include", cache: "no-store" }),
      ]);
      if (!pr.ok || !ar.ok) return null;
      const pj = (await pr.json()) as PeopleReply;
      const aj = (await ar.json()) as unknown;
      const accounts = Array.isArray(aj) ? (aj as AccountRow[]).filter((a) => a && typeof a.email === "string") : [];
      return { people: pj.people ?? [], accounts };
    } catch {
      return null;
    }
  })();
  shared = { at: Date.now(), value };
  return value;
}

export type BranchPeopleData =
  | { state: "loading" }
  | { state: "hidden" }
  | { state: "ready"; assigned: BranchPerson[]; everyBranch: BranchPerson[] };

/** the people under one branch: the members given THIS branch, and (apart) the owners / managers who reach every branch */
export function useBranchPeople(branchId: string): BranchPeopleData {
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadPeople().then((v) => { if (alive) setLoaded(v); });
    return () => { alive = false; };
  }, [branchId]);
  if (loaded === undefined) return { state: "loading" };
  if (loaded === null) return { state: "hidden" };
  return { state: "ready", ...splitBranchPeople(loaded.people, loaded.accounts, branchId) };
}

const TONES = ["#4f6df5", "#8a5cf6", "#d4568b", "#e0793a", "#2f9e8f", "#c2a23a", "#5aa0d6", "#8b8f98"];
function toneFor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

function Disc({ p, big }: { p: BranchPerson; big?: boolean }): ReactElement {
  return (
    <span className={`cr-bpp-disc${big ? " is-big" : ""}${p.status === "active" ? "" : " is-off"}`} style={{ background: toneFor(p.email || p.name) }} aria-hidden>
      {initialOf(p.name) || "?"}
    </span>
  );
}

function useRoleLabel(): (p: BranchPerson) => string {
  const tr = useTr();
  return (p) => p.roleName ?? tr(p.level === "owner" ? "Owner" : p.level === "manager" ? "Manager" : "Member");
}

/** "Last sign-in" in the words the Permissions screen uses */
function useAgo(): (iso: string | null) => string {
  const tr = useTr();
  return (iso) => {
    if (!iso) return tr("Never signed in");
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 2) return tr("Just now");
    if (min < 60) return tr("{n} min ago", { n: min });
    const h = Math.round(min / 60);
    if (h < 24) return tr("{n} h ago", { n: h });
    return tr("{n} days ago", { n: Math.round(h / 24) });
  };
}

const STRIP_MAX = 4;

/** the section of the branch screen: four people, then "See more" */
export function BranchPeople({ branchId, onSeeMore }: { branchId: string; onSeeMore: () => void }): ReactElement | null {
  const tr = useTr();
  const role = useRoleLabel();
  const d = useBranchPeople(branchId);
  if (d.state !== "ready") return null;
  const shown = d.assigned.slice(0, STRIP_MAX);
  const hidden = d.assigned.length - shown.length;
  return (
    <section className="cr-bp-sec cr-bpp" aria-label={tr("People")}>
      <div className="cr-bpp-head">
        <h3 className="cr-bp-title">{tr("People")}</h3>
        <button type="button" className="cr-bpp-more" onClick={onSeeMore}>
          {tr("See more")}
          {hidden > 0 ? <span className="cr-bpp-count"> +{hidden}</span> : null}
          <svg className="rtl:rotate-180" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="cr-bpp-empty">{tr("No one is assigned to this branch yet.")}</p>
      ) : (
        <ul className="cr-bpp-row">
          {shown.map((p) => (
            <li key={p.userId} className="cr-bpp-one">
              <Disc p={p} />
              <b className="cr-bpp-name" dir="auto">{p.name}</b>
              <span className="cr-bpp-role" dir="auto">{role(p)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** the whole screen of the people under the branch — it takes the place of the branch screen, with a way back */
export function BranchPeopleScreen({ branchId, branchName, onBack }: { branchId: string; branchName: string; onBack: () => void }): ReactElement {
  const tr = useTr();
  const role = useRoleLabel();
  const ago = useAgo();
  const d = useBranchPeople(branchId);
  const tile = (p: BranchPerson) => (
    <li key={p.userId} className="cr-bpp-tile">
      <Disc p={p} big />
      <b className="cr-bpp-name" dir="auto">{p.name}{p.isYou ? ` (${tr("You")})` : ""}</b>
      <span className="cr-bpp-role" dir="auto">{role(p)}</span>
      <span className={`cr-bpp-sub${p.status === "active" ? "" : " is-warn"}`}>{p.status === "active" ? ago(p.lastSignInAt) : tr(p.status === "paused" ? "Paused" : "Disabled")}</span>
    </li>
  );
  return (
    <div className="cr-bp cr-bpp-screen">
      <header className="cr-bp-head">
        <button type="button" onClick={onBack} className="cr-bp-icon cr-bp-back" aria-label={tr("Back")} title={tr("Back")}>
          <svg className="h-[18px] w-[18px] rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="cr-bp-name">
          <h2 dir="auto">{tr("People")}</h2>
          <p dir="auto">{branchName}</p>
        </div>
      </header>
      {d.state === "loading" ? <p className="cr-bpp-empty">…</p> : null}
      {d.state === "hidden" ? <p className="cr-bpp-empty">{tr("Only an administrator can see the people of a branch.")}</p> : null}
      {d.state === "ready" ? (
        <div className="cr-bpp-body">
          <section>
            <h3 className="cr-bp-title">{tr("On this branch")} <span className="cr-bpp-count">{d.assigned.length}</span></h3>
            {d.assigned.length === 0 ? <p className="cr-bpp-empty">{tr("No one is assigned to this branch yet.")}</p> : <ul className="cr-bpp-grid">{d.assigned.map(tile)}</ul>}
          </section>
          {d.everyBranch.length > 0 ? (
            <section>
              <h3 className="cr-bp-title">{tr("See every branch")} <span className="cr-bpp-count">{d.everyBranch.length}</span></h3>
              <p className="cr-bpp-hint">{tr("Owners and managers reach all the branches, this one too.")}</p>
              <ul className="cr-bpp-grid">{d.everyBranch.map(tile)}</ul>
            </section>
          ) : null}
          <p className="cr-bpp-foot"><Link href="/access-control" className="cr-bpp-more">{tr("Manage people and permissions")}</Link></p>
        </div>
      ) : null}
    </div>
  );
}
