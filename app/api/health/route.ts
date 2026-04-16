import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getYtDlpDiagnostics } from "@/lib/yt-dlp-search";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  const meta: Record<string, unknown> = {};

  // 1. PostgreSQL connectivity + basic row counts
  try {
    const [users, workspaces, playlists, schedules, catalog] = await Promise.all([
      prisma.user.count(),
      prisma.workspace.count(),
      prisma.playlist.count(),
      prisma.schedule.count(),
      prisma.catalogItem.count(),
    ]);
    checks.database = "ok";
    meta.db = { users, workspaces, playlists, schedules, catalog };
  } catch (err) {
    checks.database = "fail";
    meta.db_error = err instanceof Error ? err.message : String(err);
  }

  // 2. yt-dlp diagnostics (non-fatal — never blocks health status)
  let ytdlp = null;
  try {
    ytdlp = await getYtDlpDiagnostics();
    checks.ytdlp = ytdlp.instanceReady && ytdlp.version !== null ? "ok" : "fail";
  } catch {
    checks.ytdlp = "fail";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "degraded",
      checks,
      ...meta,
      ytdlp,
      ts: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  );
}
