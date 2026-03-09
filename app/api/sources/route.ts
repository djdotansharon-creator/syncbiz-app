import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import type { Source } from "@/lib/types";

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
    tags: data.tags ?? [],
    isLive: data.isLive ?? false,
  });

  return NextResponse.json(source, { status: 201 });
}
