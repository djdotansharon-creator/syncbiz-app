"use client";

/**
 * CONTROL ROOM — the reads the Schedule section and the offer screen share (owner 2026-11-25, phase 2): the playlists the workspace already lists (name + cover, so a block is drawn as the Studio draws it),
 * the branch's own schedule blocks + its schedule switch, and the calm one-line confirmation that is handed from the offer screen back to the branch screen. Reads only — nothing here writes.
 */
import { useEffect, useState, type ReactElement } from "react";
import type { Schedule } from "@/lib/types";
import { isSafeCover } from "@/lib/branch-schedule-lane";
import { SHARE_MS } from "@/components/control-room/branch-schedule-parts";

export type PlaylistInfo = { name: string; cover: string | null };

let playlistsShared: { at: number; value: Promise<Map<string, PlaylistInfo>> } | null = null;
/** playlist id → name + cover (the workspace's own list, one shared read) — the covers of the Studio's blocks come from the same list */
export function loadPlaylists(): Promise<Map<string, PlaylistInfo>> {
  if (playlistsShared && Date.now() - playlistsShared.at < SHARE_MS) return playlistsShared.value;
  const value = (async (): Promise<Map<string, PlaylistInfo>> => {
    const m = new Map<string, PlaylistInfo>();
    try {
      const r = await fetch("/api/playlists", { credentials: "include", cache: "no-store" });
      if (!r.ok) return m;
      const j = (await r.json()) as unknown;
      if (Array.isArray(j)) {
        for (const p of j as { id?: unknown; name?: unknown; cover?: unknown; thumbnail?: unknown }[]) {
          if (typeof p?.id !== "string" || typeof p?.name !== "string") continue;
          const c = typeof p.cover === "string" && p.cover.trim() ? p.cover.trim() : typeof p.thumbnail === "string" && p.thumbnail.trim() ? p.thumbnail.trim() : "";
          m.set(p.id, { name: p.name, cover: isSafeCover(c) ? c : null });
        }
      }
    } catch {
      /* names and covers are a courtesy — a block falls back to its own name and the placeholder */
    }
    return m;
  })();
  playlistsShared = { at: Date.now(), value };
  return value;
}

/** the playlists (name + cover), or null while they load */
export function usePlaylists(): Map<string, PlaylistInfo> | null {
  const [m, setM] = useState<Map<string, PlaylistInfo> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPlaylists().then((v) => { if (alive) setM(v); });
    return () => { alive = false; };
  }, []);
  return m;
}

export type SchedState = { branchId: string; status: "ready" | "error"; items: Schedule[]; enabled: boolean };

/** the branch's schedule blocks + its schedule switch (the `X-Schedule-Enabled` header the same request carries); null = loading the first time */
export function useBranchSchedules(branchId: string, tick: number): { state: SchedState | null; loading: boolean } {
  const [state, setState] = useState<SchedState | null>(null);
  const [doneKey, setDoneKey] = useState("");
  const key = `${branchId}:${tick}`;
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/schedules?branchId=${encodeURIComponent(branchId)}`, { credentials: "include", cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as unknown;
        if (alive) setState({ branchId, status: "ready", items: Array.isArray(j) ? (j as Schedule[]) : [], enabled: r.headers.get("X-Schedule-Enabled") !== "0" });
      } catch {
        if (alive) setState({ branchId, status: "error", items: [], enabled: true });
      } finally {
        if (alive) setDoneKey(key);
      }
    })();
    return () => { alive = false; };
  }, [branchId, key]);
  return { state: state && state.branchId === branchId ? state : null, loading: doneKey !== key };
}

// ── the calm line handed back to the branch screen ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const notices = new Map<string, string>();
/** the offer screen says what happened ("Done …" / "Closed …") — the branch screen it returns to shows it once */
export function postScheduleNotice(branchId: string, text: string): void {
  notices.set(branchId, text);
}
/** the line for this branch, if there is one (a pure read — React may ask twice) */
export function peekScheduleNotice(branchId: string): string | null {
  return notices.get(branchId) ?? null;
}
/** once the branch screen has it on screen, it is forgotten (so a later visit starts clean) */
export function clearScheduleNotice(branchId: string): void {
  notices.delete(branchId);
}

export function Spinner({ label }: { label: string }): ReactElement {
  return <span className="cr-sch-spin" role="status" aria-label={label} />;
}
