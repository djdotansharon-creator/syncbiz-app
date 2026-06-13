import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import {
  getAllDevicePlayerStates,
  updateDevicePlayerState,
} from "@/lib/player-command-store";
import type { BrowserPreference } from "@/lib/types";

/**
 * Pilot rule: this route no longer shells out to Winamp / OS default app.
 * The `play` and `stop` actions previously ran `cmd /c start "" "<path>"` /
 * `taskkill /IM winamp.exe /F` via `runLocalPlaylist` / `runStopLocal`. Those
 * are removed. Device player state is still tracked so the existing UI keeps
 * working; actual audio output is owned by `PlaybackProvider` (Desktop MPV or
 * browser embed) and the MASTER device on the WebSocket bus.
 */

type PlayerAction = "play" | "pause" | "resume" | "stop" | "seek" | "volume" | "next" | "prev" | "status";

type CommandBody = {
  action: PlayerAction;
  target?: string;
  deviceId?: string;
  browserPreference?: BrowserPreference;
  currentTime?: number;
  volume?: number;
  openInBrowser?: boolean;
};

export async function GET() {
  return NextResponse.json({ items: getAllDevicePlayerStates() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as CommandBody;
  const action = body.action;
  const target = (body.target ?? "").trim();
  const deviceId = (body.deviceId ?? "local-device").trim() || "local-device";
  const browserPreference = body.browserPreference ?? "default";
  const currentTime = Number.isFinite(body.currentTime) ? Number(body.currentTime) : 0;
  const volume = Number.isFinite(body.volume) ? Number(body.volume) : 80;

  if (!action) {
    return NextResponse.json({ error: "action is required" }, { status: 400 });
  }

  console.log("[player-commands] hit", { action, deviceId, target, browserPreference });

  if (action === "play") {
    if (!target) {
      return NextResponse.json({ error: "target is required for play" }, { status: 400 });
    }
    const state = updateDevicePlayerState(deviceId, {
      status: "playing",
      target,
      currentTime,
      volume,
    });

    db.addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Player page play (state only, no shell-out): ${target} on ${deviceId} (${browserPreference})`,
      deviceId,
    });
    return NextResponse.json({ ok: true, state, shellOutDisabled: true });
  }

  if (action === "stop") {
    const state = updateDevicePlayerState(deviceId, {
      status: "stopped",
      currentTime: 0,
      volume,
    });
    db.addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Player page stop (state only, no taskkill): ${deviceId}`,
      deviceId,
    });
    return NextResponse.json({ ok: true, state, shellOutDisabled: true });
  }

  const statusMap: Record<PlayerAction, "playing" | "paused" | "stopped"> = {
    play: "playing",
    pause: "paused",
    resume: "playing",
    stop: "stopped",
    seek: "playing",
    volume: "playing",
    next: "playing",
    prev: "playing",
    status: "playing",
  };

  const state = updateDevicePlayerState(deviceId, {
    status: statusMap[action],
    target,
    currentTime,
    volume,
  });

  db.addLog({
    timestamp: new Date().toISOString(),
    level: "info",
    message: `Player page ${action} on ${deviceId}`,
    deviceId,
  });
  return NextResponse.json({ ok: true, state });
}
