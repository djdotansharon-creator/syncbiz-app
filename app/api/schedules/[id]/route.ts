import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deleted = db.deleteSchedule(id);
  if (!deleted) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
