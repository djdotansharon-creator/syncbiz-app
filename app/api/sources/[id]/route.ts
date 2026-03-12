import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { addDeletedSourceId } from "@/lib/deleted-sources-store";
import type { Source } from "@/lib/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const source = db.getSources().find((s) => s.id === id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  return NextResponse.json(source);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = (await req.json()) as Partial<{ name: string; target: string; type: string; description?: string; artworkUrl?: string; browserPreference?: string }>;
  const source = db.getSources().find((s) => s.id === id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  const updated = db.updateSource(id, {
    ...(data.name != null && { name: data.name }),
    ...(data.target != null && { target: data.target, uriOrPath: data.target }),
    ...(data.type != null && { type: data.type as Source["type"] }),
    ...(data.description != null && { description: data.description }),
    ...(data.artworkUrl != null && { artworkUrl: data.artworkUrl }),
    ...(data.browserPreference != null && { browserPreference: data.browserPreference as Source["browserPreference"] }),
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const exists = db.getSources().some((s) => s.id === id);
  if (!exists) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  await addDeletedSourceId(id);
  db.deleteSource(id);
  return NextResponse.json({ ok: true });
}
