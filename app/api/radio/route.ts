import { NextRequest, NextResponse } from "next/server";
import { listRadioStations, createRadioStation } from "@/lib/radio-store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";

const DEFAULT_BRANCH_ID = "default";

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const all = await listRadioStations();
    const filtered = [];
    for (const s of all) {
      const branchId = resolveMediaBranchId(s);
      if (await hasBranchAccess(user.id, branchId)) {
        filtered.push(s);
      }
    }
    return NextResponse.json(filtered);
  } catch (e) {
    console.error("[api/radio] GET", e);
    return NextResponse.json({ error: "Failed to list radio stations" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = (await req.json()) as { name?: string; url?: string; genre?: string; cover?: string | null; branchId?: string };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const branchId = (body.branchId ?? DEFAULT_BRANCH_ID).trim() || DEFAULT_BRANCH_ID;
    if (!name || !url) {
      return NextResponse.json({ error: "name and url are required" }, { status: 400 });
    }
    if (!(await hasBranchAccess(user.id, branchId))) {
      return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
    }
    const station = await createRadioStation({
      name,
      url,
      genre: typeof body.genre === "string" ? body.genre.trim() : "Radio",
      cover: body.cover ?? null,
      branchId,
    });
    const uid = await getUserIdFromSession();
    if (uid) void notifyLibraryUpdated(uid, { branchId, entityType: "radio", action: "created" });
    return NextResponse.json(station);
  } catch (e) {
    console.error("[api/radio] POST", e);
    return NextResponse.json({ error: "Failed to create radio station" }, { status: 500 });
  }
}
