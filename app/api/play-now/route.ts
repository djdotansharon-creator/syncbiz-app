import { NextRequest, NextResponse } from "next/server";
import { runLocalPlaylist } from "@/lib/play-local";
import { db } from "@/lib/store";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { sourceId: string; deviceId?: string };
  const { sourceId, deviceId } = body;

  if (!sourceId) {
    return NextResponse.json(
      { error: "sourceId is required" },
      { status: 400 },
    );
  }

  const sources = db.getSources();
  const devices = db.getDevices();
  const source = sources.find((s) => s.id === sourceId);
  const device = deviceId ? devices.find((d) => d.id === deviceId) : null;

  if (!source) {
    return NextResponse.json(
      { error: "Source not found" },
      { status: 404 },
    );
  }

  const path = (source.target ?? source.uriOrPath ?? "").trim();
  const deviceName = device ? device.name : "no device specified";

  if (source.type === "local_playlist" && path) {
    console.log("[play-now] Local playlist endpoint hit", {
      sourceId,
      sourceName: source.name,
      targetPath: path,
    });

    const result = await runLocalPlaylist(path);

    if (result.success) {
      console.log("[play-now] Command executed successfully:", path);
      const log = db.addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Local playback: opened "${path}" with default app.`,
        deviceId: device?.id,
        sourceId: source.id,
      });
      return NextResponse.json({ ok: true, log });
    }

    console.error("[play-now] Command failed:", result.error);
    db.addLog({
      timestamp: new Date().toISOString(),
      level: "error",
      message: `Local playback failed: ${result.error} – "${source.name}" (${path})`,
      deviceId: device?.id,
      sourceId: source.id,
    });
    return NextResponse.json(
      { error: result.error },
      { status: 500 },
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
