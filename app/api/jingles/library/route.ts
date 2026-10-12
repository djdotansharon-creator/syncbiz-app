import { NextResponse } from "next/server";
import { shadowAuthorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";
import { canonicalContentBranchForWrite } from "@/lib/branch-resolver";
import { actorFor, listJingles, loadWorkspaceFacts, resolveCreate, rowToItem } from "@/lib/jingles/library-service";

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
 *
 * Jingles Stage 1 (owner 2026-10-12): ORIGIN + AUDIENCE (lib/jingles/audience.ts, lib/jingles/library-service.ts).
 *  - GET  ?branchId=  → exactly what that branch is eligible for (never UNASSIGNED); without it: HQ = everything
 *    (incl. UNASSIGNED, flagged playable:false), a branch user = what its branches are eligible for.
 *  - POST audience / audienceBranchId / audienceBrandId / audienceRegion / originBranchId (optional): HQ default
 *    UNASSIGNED; a branch user only LOCAL for its own branch. Brand A never receives a Brand B jingle.
 *  - PATCH /api/jingles/library/<id> changes the audience (promote) — HQ only, same row.
 */

export const dynamic = "force-dynamic";

const JINGLE_TYPE = "jingle";

// Every jingle MP3 is written by the generate route / saveMp3, both of which use crypto.randomUUID()
// and expose it at `/api/jingles/audio/<uuid>`. A jingle url must resolve to exactly that internal
// audio path — either relative, or absolute against the SAME origin as this request. Anything else
// (external origin, javascript:/data:/file:, arbitrary path) is rejected so the library can never
// store — or later hand to playback — an arbitrary URL.
const AUDIO_PATH_RE =
  /^\/api\/jingles\/audio\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestHost(req: Request): string | null {
  const h = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return h ? h.split(",")[0].trim().toLowerCase() : null;
}

function isLegitJingleUrl(url: string, req: Request): boolean {
  // Relative internal path (the shape the generate route returns). Handled first because a bare
  // path has no base for `new URL`. Anchored regex also rejects "//evil.com/..." (protocol-relative)
  // and any query/fragment/traversal.
  if (url.startsWith("/")) return AUDIO_PATH_RE.test(url);
  // Absolute URL: must be http(s), same host as the current request, and the audio path.
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false; // reject javascript:/data:/file:
  const host = requestHost(req);
  if (!host || u.host.toLowerCase() !== host) return false; // reject external origin
  return AUDIO_PATH_RE.test(u.pathname);
}

export async function GET(req: Request) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const facts = await loadWorkspaceFacts(user.tenantId);
  const actor = await actorFor(user.id, facts);
  const branchId = new URL(req.url).searchParams.get("branchId");
  const res = await listJingles(actor, facts, { branchId });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ items: res.items });
}

export async function POST(req: Request) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  shadowAuthorize("jingles/library:POST", { userId: user.id, workspaceId: user.tenantId }, "content.manage", ["default"]); // Gate 3A shadow: log only, never blocks

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
  if (!isLegitJingleUrl(url, req)) {
    return NextResponse.json({ error: "url must be a SyncBiz jingle audio path" }, { status: 400 });
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
  if (existing) return NextResponse.json({ item: rowToItem(existing) }, { status: 200 });

  // ORIGIN + AUDIENCE (permission-checked): HQ default UNASSIGNED; a branch user only LOCAL for its own branch
  const facts = await loadWorkspaceFacts(user.tenantId);
  const actor = await actorFor(user.id, facts);
  const resolved = resolveCreate(actor, facts, body);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  const row = await prisma.announcement.create({
    data: {
      workspaceId: user.tenantId,
      announcementType: JINGLE_TYPE,
      // Gate 2B-1 (LEGACY column, unchanged): the workspace's canonical branch. Never used for origin / audience.
      branchId: await canonicalContentBranchForWrite(user.tenantId, "default"),
      name: title,
      audioUrl: url,
      voiceId,
      durationSec,
      text: script,
      originBranchId: resolved.originBranchId,
      audience: resolved.audience.audience,
      audienceBranchId: resolved.audience.audienceBranchId,
      audienceBrandId: resolved.audience.audienceBrandId,
      audienceRegion: resolved.audience.audienceRegion,
    },
  });

  return NextResponse.json({ item: rowToItem(row) }, { status: 201 });
}
