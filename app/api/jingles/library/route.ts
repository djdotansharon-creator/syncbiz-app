import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";

/**
 * Cloud Jingle Library — the single authoritative list of saved jingles per workspace.
 *
 * Source of truth: the shared `Announcement` rows tagged `announcementType = "jingle"` with a
 * non-null `audioUrl` (the MP3 stays in the existing cloud audio storage / Railway volume, served
 * at `/api/jingles/audio/<id>` — this route persists only the METADATA). Every authenticated
 * client (Desktop MASTER, Browser CONTROL, Mobile) reads the same list; none owns a canonical copy.
 *
 * Security: workspace is ALWAYS derived from the authenticated session (`user.tenantId`); the
 * client can never spoof it. Unauthenticated → 401. A user only ever sees/creates jingles in their
 * own workspace.
 */

export const dynamic = "force-dynamic";

const JINGLE_TYPE = "jingle";

type JingleLibraryItem = {
  id: string;
  title: string;
  url: string;
  script: string;
  voiceId: string;
  durationSec: number | null;
  createdAt: string;
};

function rowToItem(r: {
  id: string; name: string; audioUrl: string | null; text: string;
  voiceId: string | null; durationSec: number | null; createdAt: Date;
}): JingleLibraryItem {
  return {
    id: r.id,
    title: r.name,
    url: r.audioUrl ?? "",
    script: r.text ?? "",
    voiceId: r.voiceId ?? "",
    durationSec: r.durationSec ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await prisma.announcement.findMany({
    where: { workspaceId: user.tenantId, announcementType: JINGLE_TYPE, audioUrl: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ items: rows.map(rowToItem) });
}

export async function POST(req: Request) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!title || !url) {
    return NextResponse.json({ error: "title and url are required" }, { status: 400 });
  }
  const voiceId = typeof body.voiceId === "string" && body.voiceId ? body.voiceId : null;
  const script = typeof body.script === "string" ? body.script : "";
  const durationSec =
    typeof body.durationSec === "number" && Number.isFinite(body.durationSec)
      ? Math.max(0, Math.round(body.durationSec))
      : null;

  // Idempotent by audio identity: a jingle whose MP3 URL already exists in this workspace is not
  // duplicated (makes the one-time localStorage import safe to run repeatedly).
  const existing = await prisma.announcement.findFirst({
    where: { workspaceId: user.tenantId, announcementType: JINGLE_TYPE, audioUrl: url },
  });
  const row =
    existing ??
    (await prisma.announcement.create({
      data: {
        workspaceId: user.tenantId,
        announcementType: JINGLE_TYPE,
        branchId: "default",
        name: title,
        audioUrl: url,
        voiceId,
        durationSec,
        text: script,
      },
    }));

  return NextResponse.json({ item: rowToItem(row) }, { status: existing ? 200 : 201 });
}
