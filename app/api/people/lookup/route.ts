import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getAccessType } from "@/lib/user-store";
import { getPlaylist } from "@/lib/playlist-store";
import { gatePlaylistAccess } from "@/lib/playlist-access";
import { allowHit } from "@/lib/simple-rate-limit";
import { findPersonByHandle } from "@/lib/playlist-share-store";

/**
 * Find a person by their EXACT VONO ID, to confirm who a playlist is about to be shared with (owner 2026-11-23, sharing phase D). Exact only — a partial or malformed ID finds nobody, there is no list and no search;
 * only someone who may share THAT playlist out (its creator, or an owner of the business) may ask — send ?playlistId=; at most 30 questions a minute; "no such person" and "disabled" give the same answer. Replies the display name and the ID — nothing else about the person.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = (user.tenantId ?? "").trim();
  if (!tenantId) return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  const playlistId = (req.nextUrl.searchParams.get("playlistId") ?? "").trim();
  const playlist = playlistId ? await getPlaylist(playlistId) : null;
  if (playlistId) {
    const g = await gatePlaylistAccess(user, playlist);
    if (!g.allow) return NextResponse.json({ error: g.message }, { status: g.httpStatus });
  }
  const isCreator = !!playlist?.createdByUserId && playlist.createdByUserId === user.id;
  if (!isCreator && (await getAccessType(user.id, tenantId)) !== "OWNER") return NextResponse.json({ error: "Only the person who made this playlist, or an owner of the business, can look people up for it" }, { status: 403 });
  if (!allowHit(`people-lookup:${user.id}`, 30, 60 * 1000)) return NextResponse.json({ error: "Too many lookups. Try again in a minute." }, { status: 429 });
  try {
    const found = await findPersonByHandle(req.nextUrl.searchParams.get("handle") ?? "");
    if (!found || !found.active) return NextResponse.json({ error: "No person with this ID" }, { status: 404 });
    if (found.id === user.id) return NextResponse.json({ error: "That is your own ID" }, { status: 400 });
    return NextResponse.json({ name: found.name, handle: found.handle });
  } catch (e) {
    console.error("[api/people/lookup] error:", e);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }
}
