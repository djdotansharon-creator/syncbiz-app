import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

/**
 * READ-ONLY public summary of the community-feedback zone for one catalog track.
 * Aggregates `UserMetadataContribution` by DISTINCT user (anti-gaming) and returns ONLY public,
 * non-identifying counts — never userEmail, never raw notes. This is the separate feedback layer;
 * it does not read or expose the authoritative catalog metadata.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });

  const catalogItemId = req.nextUrl.searchParams.get("catalogItemId")?.trim();
  if (!catalogItemId) return NextResponse.json({ error: "catalogItemId is required." }, { status: 400 });

  const rows = await prisma.userMetadataContribution.findMany({
    where: { catalogItemId },
    select: { userId: true, greatTrack: true, genre: true, mood: true, publicTags: true },
  });

  const contributors = new Set<string>();
  const greatUsers = new Set<string>();
  // lowercased key -> { label (first-seen casing), users }
  const genre = new Map<string, { label: string; users: Set<string> }>();
  const mood = new Map<string, { label: string; users: Set<string> }>();
  const tag = new Map<string, { label: string; users: Set<string> }>();

  const bump = (m: Map<string, { label: string; users: Set<string> }>, raw: string | null | undefined, uid: string) => {
    const label = (raw ?? "").trim();
    if (!label) return;
    const key = label.toLowerCase();
    let e = m.get(key);
    if (!e) { e = { label, users: new Set<string>() }; m.set(key, e); }
    e.users.add(uid);
  };

  for (const r of rows) {
    contributors.add(r.userId);
    if (r.greatTrack) greatUsers.add(r.userId);
    bump(genre, r.genre, r.userId);
    bump(mood, r.mood, r.userId);
    for (const t of r.publicTags ?? []) bump(tag, t, r.userId);
  }

  const top = (m: Map<string, { label: string; users: Set<string> }>) =>
    [...m.values()]
      .map((e) => ({ label: e.label, count: e.users.size }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 6);

  return NextResponse.json({
    catalogItemId,
    contributorCount: contributors.size,
    greatCount: greatUsers.size,
    genres: top(genre),
    moods: top(mood),
    tags: top(tag),
  });
}
