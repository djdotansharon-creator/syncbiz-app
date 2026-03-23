import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import type { Source } from "@/lib/types";

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const all = db.getSources();
  const filtered: Source[] = [];
  for (const s of all) {
    const branchId = s.branchId ?? "default";
    if (await hasBranchAccess(user.id, branchId)) {
      filtered.push(s);
    }
  }
  return NextResponse.json(filtered);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const data = (await req.json()) as Partial<Source> & { uriOrPath?: string };

  const target = data.target ?? data.uriOrPath;
  if (!data.name || !data.type || !target || !data.branchId) {
    return NextResponse.json(
      {
        error: "name, type, target (or uriOrPath), and branchId are required for creating a source",
      },
      { status: 400 },
    );
  }
  const branchId = (data.branchId ?? "default").trim() || "default";
  if (!(await hasBranchAccess(user.id, branchId))) {
    return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
  }

  const source = db.addSource({
    name: data.name,
    branchId: data.branchId,
    type: data.type,
    target,
    description: data.description,
    capabilities: data.capabilities,
    artworkUrl: data.artworkUrl,
    fallbackUriOrPath: data.fallbackUriOrPath,
    browserPreference: data.browserPreference,
    provider: data.provider,
    playerMode: data.playerMode,
    tags: data.tags ?? [],
    isLive: data.isLive ?? false,
  });

  const userId = await getUserIdFromSession();
  if (userId) void notifyLibraryUpdated(userId, { branchId: data.branchId, entityType: "source", action: "created" });
  return NextResponse.json(source, { status: 201 });
}
