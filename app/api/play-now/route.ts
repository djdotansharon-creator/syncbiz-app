import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";

/**
 * POST /api/play-now — DISABLED shell-out branch for pilot.
 *
 * The previous implementation called `runLocalPlaylist()` for `local_playlist` sources,
 * which shelled out via `cmd /c start "" "<path>"` (Winamp on machines where Winamp is
 * the default audio handler). That is no longer allowed. Non-local "play now" still
 * logs an informational entry the way it always did; local sources are short-circuited
 * with a 410 because the in-app player owns local playback now.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { sourceId: string; deviceId?: string };
  const { sourceId, deviceId } = body;

  if (!sourceId) {
    return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  }

  const sources = await db.getSources();
  const devices = await db.getDevices();
  const source = sources.find((s) => s.id === sourceId);
  const device = deviceId ? devices.find((d) => d.id === deviceId) : null;

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const path = (source.target ?? source.uriOrPath ?? "").trim();
  const deviceName = device ? device.name : "no device specified";

  if (source.type === "local_playlist" && path) {
    return NextResponse.json(
      {
        ok: false,
        disabled: true,
        error:
          "Local playlist shell-out is disabled. Open the playlist in SyncBiz Desktop — playback runs through the in-app MPV engine.",
      },
      { status: 410 },
    );
  }

  const message = `Play now: "${source.name}" (${source.target ?? source.uriOrPath}) on ${deviceName}.`;
  const log = db.addLog({
    timestamp: new Date().toISOString(),
    level: "info",
    message,
    deviceId: device?.id,
    sourceId: source.id,
  });

  return NextResponse.json({ ok: true, log });
}
