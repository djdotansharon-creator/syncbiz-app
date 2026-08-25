import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

const clip = (s: unknown, n = 120): string | null => {
  const t = (s == null ? "" : String(s)).trim();
  return t ? t.slice(0, n) : null;
};
const ENERGY = new Set(["LOW", "MEDIUM", "HIGH"]);

/**
 * A regular USER suggests PUBLIC metadata for a track. Saved as PENDING only.
 * - Never edits the official catalog, a music file, or private data.
 * - Accepts ONLY public fields the user typed + public title/artist. It NEVER reads or stores a
 *   localRef / filename / metadataHash / private comment — the track ref is a hash of title+artist.
 * - An ADMIN reviews (approve/reject) later via a separate surface.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Please sign in to suggest metadata." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }

  const trackTitle = clip(body.trackTitle);
  const trackArtist = clip(body.trackArtist);
  if (!trackTitle && !trackArtist) return NextResponse.json({ error: "A track title or artist is required." }, { status: 400 });

  // Public, opaque reference derived from public strings only — never a localRef/filename/path.
  const trackPublicId = "trk_" + createHash("sha256").update(`${(trackTitle ?? "").toLowerCase()}|${(trackArtist ?? "").toLowerCase()}`).digest("hex").slice(0, 16);

  const energy = clip(body.energy)?.toUpperCase() ?? null;
  const publicTags = Array.isArray(body.publicTags)
    ? (body.publicTags.map((t) => clip(t, 40)).filter(Boolean) as string[]).slice(0, 12)
    : [];

  // RELIABLE catalog link captured at submit time (optional). This is the trustworthy join to
  // catalog — kept in a SEPARATE community-feedback layer, never written back onto CatalogItem.
  const catalogItemId = clip(body.catalogItemId, 64);
  const greatTrack = body.greatTrack === true;

  try {
    const contribution = await prisma.userMetadataContribution.create({
      data: {
        userId: user.id,
        userEmail: user.email ?? null,
        trackPublicId, catalogItemId, trackTitle, trackArtist,
        genre: clip(body.genre),
        mood: clip(body.mood),
        energy: energy && ENERGY.has(energy) ? energy : null,
        daypart: clip(body.daypart),
        businessType: clip(body.businessType),
        publicTags,
        note: clip(body.note, 500),
        greatTrack,
        status: "PENDING", // always PENDING — a user can never publish to the catalog
      },
      select: { id: true, status: true, createdAt: true },
    });
    return NextResponse.json({ ok: true, contribution });
  } catch (err) {
    // Surface the real cause server-side (never hidden) — e.g. a missing table/column when the
    // connected DB is behind on the community-feedback migrations. Always answer with valid JSON so
    // the client never hits "Unexpected end of JSON input".
    console.error("[contributions] create failed:", err);
    return NextResponse.json({ error: "Could not save your suggestion. Please try again." }, { status: 500 });
  }
}
