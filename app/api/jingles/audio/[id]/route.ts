import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";
import { verifyJingleToken } from "@/lib/jingles/jingle-token";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function jinglesDir(): string {
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return vol ? join(vol, "jingles") : join(process.cwd(), "data", "jingles");
}

/**
 * The workspace that OWNS a saved jingle id, via its Announcement metadata row
 * (announcementType="jingle", audioUrl = the internal audio path). Returns null when NO row exists —
 * i.e. a freshly generated jingle not yet saved to the library (an ephemeral preview file whose
 * 122-bit random id is returned only to its creator, not stored or enumerable anywhere). A null owner
 * means "no owning workspace to enforce against", NOT "open to everyone".
 */
async function ownerWorkspaceId(id: string): Promise<string | null> {
  const row = await prisma.announcement.findFirst({
    where: { announcementType: "jingle", audioUrl: { endsWith: `/api/jingles/audio/${id}` } },
    select: { workspaceId: true },
  });
  return row?.workspaceId ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  // Strip everything except UUID-safe characters to prevent path traversal (unchanged).
  const id = (rawId ?? "").replace(/[^a-f0-9-]/gi, "");
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // ── Workspace authorization (F3). Two accepted principals, both EXISTING mechanisms:
  //    (a) a signed jingle token on the URL (`?jt=`) — the ONLY way the station MPV can authenticate,
  //        since MPV cannot send a session cookie; the renderer appends it at dispatch.
  //    (b) the signed session cookie — the browser <audio> preview path carries it automatically.
  //    Resolved BEFORE touching the filesystem so an unauthenticated caller cannot even probe for the
  //    existence of a jingle id.
  let principalWorkspaceId: string | null = null;
  const jt = req.nextUrl.searchParams.get("jt");
  if (jt) {
    const claims = verifyJingleToken(jt);
    if (claims) principalWorkspaceId = claims.workspaceId;
  }
  if (!principalWorkspaceId) {
    const user = await getCurrentUserFromApiRequest(req);
    if (user?.tenantId) principalWorkspaceId = user.tenantId;
  }
  if (!principalWorkspaceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // A saved jingle (has an owner row): the principal MUST be that same workspace — this closes the
  // cross-tenant read (IDOR). An unsaved preview (no owner row): a valid principal is sufficient, as
  // there is no owning workspace to match and the id is not cross-tenant enumerable.
  const owner = await ownerWorkspaceId(id);
  if (owner && owner !== principalWorkspaceId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filePath = join(jinglesDir(), `${id}.mp3`);
  if (!existsSync(filePath)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buf = await readFile(filePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.byteLength),
      // The URL can now carry a credential (`jt`): keep it out of shared caches and don't leak the
      // tokenized URL via Referer (browser <audio> path only; MPV sends neither cache nor Referer).
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "Accept-Ranges": "bytes",
    },
  });
}
