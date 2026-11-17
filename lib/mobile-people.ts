"use client";

/**
 * PEOPLE ON THE PHONE (owner 2026-11-18: "a manager must be able to control these things from afar, depending on the level, of course").
 *
 * The phone adds NO rule of its own: it reads and writes through the SAME routes the computer's Permissions screen uses (/api/people, /api/admin/users, /api/join/*, /api/roles,
 * /api/people/:id/role), and every one of them answers only a workspace administrator (403 to anyone else; a locked desktop station is refused there too, a phone never is locked). So the level
 * of a person decides what the phone shows: a member / a plain manager gets nothing here ("hidden"), an administrator gets the screens, the owner and the administrators keep their level (the server
 * refuses a change of them, and the buttons are not drawn for them). What a ROLE allows (the switches) is defined on the computer; the phone only gives a person one of the existing roles.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type PersonLevel = "owner" | "manager" | "member";
export type PersonStatus = "active" | "paused" | "disabled";
export type PersonRow = {
  userId: string;
  name: string;
  email: string;
  level: PersonLevel;
  roleId: string | null;
  roleName: string | null;
  status: PersonStatus;
  lastSignInAt: string | null;
  joinedAt: string;
  isYou: boolean;
};
export type AccountRow = { email: string; accessType: "OWNER" | "BRANCH_USER"; branchIds: string[]; canRemoveFromWorkspace?: boolean; canPauseInWorkspace?: boolean; protected?: boolean };
export type JoinRequest = { id: string; email: string; firstName: string; lastName: string; phone: string; hasAccount: boolean; requestedAt: string; expiresAt: string };
export type RoleRow = { id: string; name: string; permissions?: { flags?: Record<string, boolean> } };
export type BranchRow = { id: string; name: string; city?: string };

/* ───────────────────────────── pure rules (tested without a browser) ───────────────────────────── */

/** the server's error codes → the sentence the person reads (every one has its Hebrew in lib/i18n/phrases.ts) */
export const PEOPLE_ERRORS: Record<string, string> = {
  not_yourself: "You cannot change your own role.",
  protected_member: "The owner and workspace admins keep their level.",
  protected: "The owner and workspace admins keep their level.",
  role_not_found: "That role no longer exists.",
  limit: "This business has no room for more people. Free a seat or raise the limit first.",
  not_pending: "This request was already handled.",
  too_many_codes: "There are already 10 unused codes. Wait for one to expire.",
};
export const PEOPLE_ERROR_FALLBACK = "Something went wrong. Please try again.";
export function peopleErrorText(code: string | undefined): string {
  return (code ? PEOPLE_ERRORS[code] : undefined) ?? PEOPLE_ERROR_FALLBACK;
}

/** an owner, a manager and anyone with full access keep their level: no role and no branch choice is offered for them */
export function isAdminLevel(p: Pick<PersonRow, "level">, account: Pick<AccountRow, "accessType"> | null): boolean {
  return p.level !== "member" || account?.accessType === "OWNER";
}

/** may the phone offer "pause sign-in" / "remove" for this person? — the computer's own rule (never yourself, never the owner, and only when the server says the account allows it) */
export function accountActionsFor(p: Pick<PersonRow, "isYou" | "level">, account: Pick<AccountRow, "canPauseInWorkspace" | "canRemoveFromWorkspace"> | null): { canPause: boolean; canRemove: boolean } {
  const base = !!account && !p.isYou && p.level !== "owner";
  return { canPause: base && account!.canPauseInWorkspace !== false, canRemove: base && account!.canRemoveFromWorkspace !== false };
}

/** the role a request is approved with when nobody picked one: the LAST role of the list (the computer's rule), or a plain member when roles are off */
export function defaultApprovalRole(roles: readonly RoleRow[]): string {
  return roles.length > 0 ? roles[roles.length - 1].id : "MEMBER";
}

/** the body of an approval: with roles on it carries `roleId`, without them the level (member / manager) */
export function approvalBody(decision: "approve" | "reject", chosen: string, rolesOn: boolean): Record<string, string> {
  return rolesOn ? { decision, roleId: chosen } : { decision, role: chosen === "MANAGER" ? "MANAGER" : "MEMBER" };
}

/** the list order: people who can sign in first, then a paused / disabled one, each group by name */
export function orderPeople<P extends Pick<PersonRow, "status" | "name">>(people: readonly P[]): P[] {
  return [...people].sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || a.name.localeCompare(b.name));
}

/** the search box: a name, an e-mail, a role or the level */
export function matchesPerson(p: Pick<PersonRow, "name" | "email" | "roleName">, level: string, q: string): boolean {
  const n = q.trim().toLowerCase();
  return !n || [p.name, p.email, p.roleName ?? "", level].some((x) => x.toLowerCase().includes(n));
}

/** the branches a member may reach, as the person sees them ("All branches" / names / none) */
export function branchReach(account: Pick<AccountRow, "accessType" | "branchIds"> | null, branches: readonly BranchRow[]): { all: boolean; names: string[] } {
  if (!account || account.accessType !== "BRANCH_USER") return { all: false, names: [] };
  const names = branches.filter((b) => account.branchIds.includes(b.id)).map((b) => b.name);
  return { all: branches.length > 0 && names.length === branches.length, names };
}

/** has the choice of branches changed — and is it a choice the server accepts (at least one)? */
export function branchChoiceState(account: Pick<AccountRow, "accessType" | "branchIds"> | null, picked: readonly string[]): { dirty: boolean; valid: boolean } {
  const was = account?.accessType === "BRANCH_USER" ? account.branchIds : [];
  const dirty = picked.length !== was.length || picked.some((id) => !was.includes(id));
  return { dirty, valid: picked.length > 0 };
}

/* ───────────────────────────── writes (the computer's routes, unchanged) ───────────────────────────── */

export type ActionResult = { ok: true } | { ok: false; error?: string };

async function send(url: string, method: "POST" | "PUT" | "PATCH", body?: unknown): Promise<ActionResult> {
  try {
    const r = await fetch(url, { method, credentials: "include", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error };
  } catch {
    return { ok: false };
  }
}

export const giveRole = (userId: string, roleId: string) => send(`/api/people/${encodeURIComponent(userId)}/role`, "PUT", { roleId });
export const saveBranches = (email: string, branchIds: string[]) => send("/api/admin/users", "PATCH", { email, accessType: "BRANCH_USER", branchIds });
export const accountAction = (email: string, action: "pause-member" | "resume-member" | "remove-member") => send(`/api/admin/users/${action}`, "POST", { email });
export const decideRequest = (id: string, decision: "approve" | "reject", chosen: string, rolesOn: boolean) => send(`/api/join/requests/${encodeURIComponent(id)}`, "POST", approvalBody(decision, chosen, rolesOn));

/** a one-time code (works once, short-lived — the server decides) */
export async function makeJoinCode(): Promise<{ ok: true; code: string; expiresAt: number } | { ok: false; error?: string }> {
  try {
    const r = await fetch("/api/join/codes", { method: "POST", credentials: "include" });
    const j = (await r.json().catch(() => ({}))) as { code?: string; expiresAt?: string; error?: string };
    if (!r.ok || !j.code || !j.expiresAt) return { ok: false, error: j.error };
    return { ok: true, code: j.code, expiresAt: new Date(j.expiresAt).getTime() };
  } catch {
    return { ok: false };
  }
}

/* ───────────────────────────── reads ───────────────────────────── */

export type PeopleAdmin =
  | { state: "loading" }
  | { state: "hidden" }
  | { state: "error"; retry: () => void }
  | { state: "ready"; people: PersonRow[]; accounts: AccountRow[]; requests: JoinRequest[]; joinOn: boolean; roles: RoleRow[]; rolesOn: boolean; branches: BranchRow[]; reload: () => Promise<void> };

type Loaded = { people: PersonRow[]; accounts: AccountRow[]; requests: JoinRequest[]; joinOn: boolean; roles: RoleRow[]; rolesOn: boolean; branches: BranchRow[] };

async function jsonOrNull<T>(url: string): Promise<{ ok: boolean; status: number; json: T | null }> {
  try {
    const r = await fetch(url, { credentials: "include", cache: "no-store" });
    return { ok: r.ok, status: r.status, json: r.ok ? ((await r.json().catch(() => null)) as T | null) : null };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

/** everything the people screens need, in one pass; "hidden" = the person is not an administrator (the server said 401 / 403) — nothing is drawn, nothing is hinted */
async function loadAll(): Promise<Loaded | "hidden" | "error"> {
  const pr = await jsonOrNull<{ people?: PersonRow[] }>("/api/people");
  if (pr.status === 401 || pr.status === 403) return "hidden";
  if (!pr.ok || !pr.json) return "error";
  const [ar, jr, rr, br] = await Promise.all([
    jsonOrNull<AccountRow[]>("/api/admin/users"),
    jsonOrNull<{ enabled?: boolean; requests?: JoinRequest[] }>("/api/join/requests"),
    jsonOrNull<{ enabled?: boolean; roles?: RoleRow[] }>("/api/roles"),
    jsonOrNull<BranchRow[]>("/api/branches"),
  ]);
  const accounts = Array.isArray(ar.json) ? ar.json.filter((a) => a && typeof a.email === "string") : [];
  const rolesOn = Boolean(rr.json?.enabled);
  return {
    people: pr.json.people ?? [],
    accounts,
    requests: jr.json?.requests ?? [],
    joinOn: Boolean(jr.json?.enabled),
    roles: rolesOn ? (rr.json?.roles ?? []) : [],
    rolesOn,
    branches: Array.isArray(br.json) ? br.json.filter((b) => b && typeof b.id === "string") : [],
  };
}

export function usePeopleAdmin(): PeopleAdmin {
  const [res, setRes] = useState<Loaded | "hidden" | "error" | undefined>(undefined);
  const alive = useRef(true);
  const load = useCallback(async () => {
    const v = await loadAll();
    if (!alive.current) return;
    // a failed refresh keeps what is on screen; only a first load can end in "error"
    setRes((prev) => (v === "error" && prev && prev !== "error" && prev !== "hidden" ? prev : v));
  }, []);
  useEffect(() => {
    alive.current = true;
    const t = window.setTimeout(() => void load(), 0);
    const onFocus = () => void load(); // another administrator may have decided a request
    window.addEventListener("focus", onFocus);
    return () => {
      alive.current = false;
      window.clearTimeout(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);
  if (res === undefined) return { state: "loading" };
  if (res === "hidden") return { state: "hidden" };
  if (res === "error") return { state: "error", retry: () => void load() };
  return { state: "ready", ...res, reload: load };
}

/** does this person get a "People" entry at all (an administrator)? — a yes/no, nothing else is kept */
export function usePeopleAccess(): boolean | null {
  const [yes, setYes] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void jsonOrNull<unknown>("/api/people").then((r) => {
      if (alive) setYes(r.ok ? true : r.status === 401 || r.status === 403 ? false : null);
    });
    return () => {
      alive = false;
    };
  }, []);
  return yes;
}
