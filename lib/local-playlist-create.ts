"use client";

import { resolveStationBranchId } from "@/lib/station-branch";
import { withStationBranch } from "@/lib/local-playlist-branch";

/**
 * Save a playlist of LOCAL music files from this computer (owner 2026-11-22): it is saved in THIS computer's branch from the start, because its files exist only here — so its
 * schedule blocks run on this computer's schedule. Only in the desktop app, and only for a computer that was activated for a real branch; every other case sends exactly what it
 * always sent. If the server refuses the branch (the person has no access to it) the playlist is saved the old way instead — adding music must never fail because of this.
 */
export async function postLocalPlaylist(body: Record<string, unknown>): Promise<Response> {
  let branch: string | null = null;
  try {
    if (typeof window !== "undefined" && typeof window.syncbizDesktop?.getConfig === "function") branch = await resolveStationBranchId();
  } catch {
    branch = null;
  }
  const send = (b: Record<string, unknown>) =>
    fetch("/api/playlists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const stamped = withStationBranch(body, branch);
  const res = await send(stamped);
  if (stamped !== body && res.status === 403) return send(body);
  return res;
}
