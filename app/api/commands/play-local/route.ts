import { NextRequest, NextResponse } from "next/server";
import { runLocalPlaylist } from "@/lib/play-local";
import { db } from "@/lib/store";

/**
 * POST /api/commands/play-local
 * MVP: Open a local playlist file with the system default app (e.g. Winamp) on Windows.
 * Body: { "target": "D:\\path\\to\\playlist.m3u" }
 */
export async function POST(req: NextRequest) {
  let body: { target?: string };
  try {
    body = (await req.json()) as { target?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const target = typeof body?.target === "string" ? body.target.trim() : "";
  if (!target) {
    return NextResponse.json(
      { error: "target is required (path to playlist file)" },
      { status: 400 },
    );
  }

  console.log("[play-local] Endpoint hit, target:", target);

  const result = await runLocalPlaylist(target);

  if (result.success) {
    console.log("[play-local] Success");
    db.addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Local playback: opened "${target}" with default app.`,
    });
    return NextResponse.json({ ok: true, message: "Opened with default app" });
  }

  console.error("[play-local] Failure:", result.error);
  db.addLog({
    timestamp: new Date().toISOString(),
    level: "error",
    message: `Local playback failed: ${result.error} (target: ${target})`,
  });
  return NextResponse.json(
    { error: result.error },
    { status: 500 },
  );
}
