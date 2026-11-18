"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A BRANCH'S DETAILS on the phone (owner 2026-11-18: "location and details of the branch, with the option to change"). Read from /api/branches (what every signed-in person of the business may read)
 * and /api/auth/me (is this person the OWNER). The only change offered is the branch's NAME, through the Control Room's own route (PATCH /api/control-room/branches/:id — owner only, the server decides;
 * the branch number is sent back unchanged, because the station's id is built from it). The place of a branch is picked from Google on the computer, so it is shown here, not edited.
 */

export type BranchFacts = {
  name: string;
  city: string;
  address: string;
  number: string | null;
  timezone: string;
  stationVersion: string | null;
};

type DbBranch = {
  id: string;
  name?: string;
  city?: string;
  country?: string;
  timezone?: string;
  street?: string;
  houseNumber?: string;
  formattedAddress?: string | null;
  locationCode?: string | null;
  stationVersion?: string | null;
};

/** pure: the facts a branch screen shows (the Google address when there is one, otherwise the street, city and country that are filled in) */
export function branchFacts(b: DbBranch): BranchFacts {
  const street = [b.street, b.houseNumber].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
  const own = (b.formattedAddress ?? "").trim() || [street, (b.city ?? "").trim(), (b.country ?? "").trim()].filter(Boolean).join(", ");
  return {
    name: (b.name ?? "").trim(),
    city: (b.city ?? "").trim(),
    address: own,
    number: (b.locationCode ?? "").trim() || null,
    timezone: (b.timezone ?? "").trim(),
    stationVersion: (b.stationVersion ?? "").trim() || null,
  };
}

/** the name may be changed by the owner, and only when the branch has its number (the route needs it and sends it back unchanged) */
export function canRenameBranch(isOwner: boolean, facts: Pick<BranchFacts, "number"> | null): boolean {
  return isOwner && !!facts?.number;
}

export type RenameResult = { ok: true } | { ok: false; message?: string };

export async function renameBranch(id: string, name: string, number: string): Promise<RenameResult> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return { ok: false };
  try {
    const r = await fetch(`/api/control-room/branches/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: clean, branchNumber: number }),
    });
    if (r.ok) return { ok: true };
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    return { ok: false, message: j.error };
  } catch {
    return { ok: false };
  }
}

export type BranchDetails = { state: "loading" } | { state: "ready"; facts: BranchFacts | null; isOwner: boolean; reload: () => Promise<void> };

export function useBranchDetails(branchId: string): BranchDetails {
  const [data, setData] = useState<{ facts: BranchFacts | null; isOwner: boolean } | null>(null);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const [br, me] = await Promise.all([
        fetch("/api/branches", { credentials: "include", cache: "no-store" }),
        fetch("/api/auth/me", { credentials: "include", cache: "no-store" }),
      ]);
      const list = br.ok ? ((await br.json().catch(() => [])) as DbBranch[]) : [];
      const who = me.ok ? ((await me.json().catch(() => null)) as { accessType?: string } | null) : null;
      const row = Array.isArray(list) ? list.find((b) => b && b.id === branchId) : undefined;
      if (alive.current) setData({ facts: row ? branchFacts(row) : null, isOwner: who?.accessType === "OWNER" });
    } catch {
      if (alive.current) setData((d) => d ?? { facts: null, isOwner: false });
    }
  }, [branchId]);
  useEffect(() => {
    alive.current = true;
    const t = window.setTimeout(() => void load(), 0);
    return () => {
      alive.current = false;
      window.clearTimeout(t);
    };
  }, [load]);
  if (!data) return { state: "loading" };
  return { state: "ready", facts: data.facts, isOwner: data.isOwner, reload: load };
}
