import { NextRequest, NextResponse } from "next/server";
import { getRadioStation, updateRadioStation, deleteRadioStation } from "@/lib/radio-store";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const station = await getRadioStation(id);
  if (!station) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(station);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { name?: string; url?: string; genre?: string; cover?: string | null };
  const station = await updateRadioStation(id, {
    ...(typeof body.name === "string" && { name: body.name.trim() }),
    ...(typeof body.url === "string" && { url: body.url.trim() }),
    ...(typeof body.genre === "string" && { genre: body.genre.trim() }),
    ...(body.cover !== undefined && { cover: body.cover }),
  });
  if (!station) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(station);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteRadioStation(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
