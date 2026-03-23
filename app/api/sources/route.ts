import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/store";
import { parseSessionValue } from "@/lib/auth-session";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import type { Source } from "@/lib/types";

const COOKIE_NAME = "syncbiz-session";

export async function GET() {
  return NextResponse.json(db.getSources());
}

export async function POST(req: NextRequest) {
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

  const cookie = (await cookies()).get(COOKIE_NAME)?.value;
  const userId = cookie ? parseSessionValue(cookie) : null;
  if (userId) void notifyLibraryUpdated(userId, { branchId: data.branchId, entityType: "source", action: "created" });
  return NextResponse.json(source, { status: 201 });
}
