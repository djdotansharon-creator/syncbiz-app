import { NextRequest, NextResponse } from "next/server";
import { getRadioStation, updateRadioStation, deleteRadioStation } from "@/lib/radio-store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { resolveMediaBranchId } from "@/lib/media-scope-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";

async function requireRadioAccess(station: { branchId?: string } | null) {
  const user = await getCurrentUserFromCookies();
  if (!user) return { ok: false as const, status: 401 } as const;
  if (!station) return { ok: false as const, status: 404 } as const;
  const branchId = resolveMediaBranchId(station);
  if (!(await hasBranchAccess(user.id, branchId))) {
    return { ok: false as const, status: 403 } as const;
  }
  return { ok: true as const, user } as const;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const station = await getRadioStation(id);
    const access = await requireRadioAccess(station);
    if (!access.ok) {
      return NextResponse.json(
        access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Not found" },
        { status: access.status },
      );
    }
    return NextResponse.json(station!);
  } catch (e) {
    console.error("[api/radio] GET error:", e);
    return NextResponse.json({ error: "Failed to load station" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await getRadioStation(id);
    const access = await requireRadioAccess(existing);
    if (!access.ok) {
      return NextResponse.json(
        access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Not found" },
        { status: access.status },
      );
    }
    const body = (await req.json()) as { name?: string; url?: string; genre?: string; cover?: string | null };
    const station = await updateRadioStation(id, {
      ...(typeof body.name === "string" && { name: body.name.trim() }),
      ...(typeof body.url === "string" && { url: body.url.trim() }),
      ...(typeof body.genre === "string" && { genre: body.genre.trim() }),
      ...(body.cover !== undefined && { cover: body.cover }),
    });
    if (!station) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const uid = await getUserIdFromSession();
    if (uid && existing) {
      void notifyLibraryUpdated(uid, { branchId: resolveMediaBranchId(existing), entityType: "radio", action: "updated" });
    }
    return NextResponse.json(station);
  } catch (e) {
    console.error("[api/radio] PUT error:", e);
    return NextResponse.json({ error: "Failed to update station" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await getRadioStation(id);
    const access = await requireRadioAccess(existing);
    if (!access.ok) {
      return NextResponse.json(
        access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Not found" },
        { status: access.status },
      );
    }
    const ok = await deleteRadioStation(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const uid = await getUserIdFromSession();
    if (uid && existing) {
      void notifyLibraryUpdated(uid, { branchId: resolveMediaBranchId(existing), entityType: "radio", action: "deleted" });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/radio] DELETE error:", e);
    return NextResponse.json({ error: "Failed to delete station" }, { status: 500 });
  }
}
