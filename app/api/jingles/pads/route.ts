import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";
import { SAMPLER_PADS } from "@/components/jingles-control/seed-data";
import { canonicalContentBranchForWrite, expandLegacyBranchEquivalents } from "@/lib/branch-resolver";
import { readPads, writePad, type PadRepo } from "@/lib/jingle-pad-compat";

/**
 * Cloud Quick Pads — the shared pad board. One row per (workspace, branch, pad slot) so Desktop and
 * Mobile see and edit the SAME 8 canonical pads. Workspace is ALWAYS derived from the authenticated
 * session (never from the client); branchId is the single-branch V1 "default" for now.
 *
 * Gate 2B-1 (canonical-branch transition): a pad may be stored under the legacy "default" OR the workspace's
 * canonical branch id. GET returns the pad from either alias; POST updates the row that already represents the
 * pad (never a second copy) and creates new pads canonical. A pad present under BOTH aliases is a conflict: it is
 * not guessed — GET omits it and reports it in `conflicts`, POST returns 409 (see lib/jingle-pad-compat.ts).
 *
 * POST is an idempotent per-pad upsert keyed on the (workspaceId, branchId, padId) unique — two
 * clients editing DIFFERENT pads never clobber each other; the same pad is simple last-write-wins.
 */

export const dynamic = "force-dynamic";

const DEFAULT_BRANCH_ID = "default";
/** Canonical pad slots — the source of truth is the seed pad set; only these ids may be written. */
const CANONICAL_PAD_IDS = new Set(SAMPLER_PADS.map((p) => p.id));

// A pad's audio url must be an internal jingle asset (same rule as /api/jingles/library): a relative
// `/api/jingles/audio/<uuid>` path, or a same-origin absolute of it. Empty = a cleared pad.
const AUDIO_PATH_RE =
  /^\/api\/jingles\/audio\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestHost(req: Request): string | null {
  const h = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  return h ? h.split(",")[0].trim().toLowerCase() : null;
}

function isLegitPadUrl(url: string, req: Request): boolean {
  if (url === "") return true; // a cleared / label-only pad
  if (url.startsWith("/")) return AUDIO_PATH_RE.test(url);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = requestHost(req);
  if (!host || u.host.toLowerCase() !== host) return false;
  return AUDIO_PATH_RE.test(u.pathname);
}

/** Prisma wiring for the pad read/write flows (branch alias set passed in explicitly). */
const padRepo: PadRepo = {
  findMany: ({ workspaceId, branchIds, padId }) =>
    prisma.jinglePadAssignment.findMany({
      where: { workspaceId, branchId: { in: branchIds }, ...(padId ? { padId } : {}) },
      orderBy: { padId: "asc" },
    }),
  update: (id, data) => prisma.jinglePadAssignment.update({ where: { id }, data }),
  create: (data) => prisma.jinglePadAssignment.create({ data }),
};

type PadItem = {
  padId: string;
  label: string;
  url: string;
  color: string | null;
  bellStyle: string | null;
  preRoll: boolean;
};

function rowToPad(r: {
  padId: string; label: string; url: string;
  color: string | null; bellStyle: string | null; preRoll: boolean;
}): PadItem {
  return {
    padId: r.padId,
    label: r.label ?? "",
    url: r.url ?? "",
    color: r.color ?? null,
    bellStyle: r.bellStyle ?? null,
    preRoll: !!r.preRoll,
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const branchIds = await expandLegacyBranchEquivalents(user.tenantId, [DEFAULT_BRANCH_ID]);
  const { pads, conflicts } = await readPads(padRepo, user.tenantId, branchIds);
  if (conflicts.length > 0) {
    console.error("[api/jingles/pads] branch alias conflict (pad stored under legacy AND canonical branch)", JSON.stringify({ workspaceId: user.tenantId, conflicts }));
    return NextResponse.json({ items: pads.map(rowToPad), conflicts });
  }
  return NextResponse.json({ items: pads.map(rowToPad) });
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

  const padId = typeof body.padId === "string" ? body.padId.trim() : "";
  if (!CANONICAL_PAD_IDS.has(padId)) {
    return NextResponse.json({ error: "Unknown padId" }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!isLegitPadUrl(url, req)) {
    return NextResponse.json({ error: "url must be a SyncBiz jingle audio path" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label : "";
  const color = typeof body.color === "string" && body.color ? body.color : null;
  const bellStyle = typeof body.bellStyle === "string" && body.bellStyle ? body.bellStyle : null;
  const preRoll = body.preRoll === true;

  const data = { label, url, color, bellStyle, preRoll };
  const branchIds = await expandLegacyBranchEquivalents(user.tenantId, [DEFAULT_BRANCH_ID]);
  const writeBranchId = await canonicalContentBranchForWrite(user.tenantId, DEFAULT_BRANCH_ID);
  const res = await writePad(padRepo, { workspaceId: user.tenantId, padId, data, branchIds, writeBranchId });
  if (!res.ok) {
    console.error("[api/jingles/pads] branch alias conflict on write", JSON.stringify({ workspaceId: user.tenantId, padId }));
    return NextResponse.json({ error: "Pad exists under both legacy and canonical branch; not written", padId }, { status: 409 });
  }
  return NextResponse.json({ item: rowToPad(res.row) });
}
