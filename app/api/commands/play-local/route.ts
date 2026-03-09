import { NextRequest, NextResponse } from "next/server";
import { runLocalPlaylist } from "@/lib/play-local";
import { db } from "@/lib/store";
import type { BrowserPreference } from "@/lib/types";

/**
 * POST /api/commands/play-local
 * MVP: Open a local playlist file with the system default app (e.g. Winamp) on Windows.
 * Body: { "target": "D:\\path\\to\\playlist.m3u" | "https://...", "browserPreference": "default" | "chrome" | "edge" | "firefox" }
 */
export async function POST(req: NextRequest) {
  let body: { target?: string; browserPreference?: BrowserPreference };
  try {
    body = (await req.json()) as { target?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const target = typeof body?.target === "string" ? body.target.trim() : "";
  const browserPreference: BrowserPreference =
    body?.browserPreference === "chrome" ||
    body?.browserPreference === "edge" ||
    body?.browserPreference === "firefox" ||
    body?.browserPreference === "default"
      ? body.browserPreference
      : "default";
  if (!target) {
    return NextResponse.json(
      { error: "target is required (URL or local path)" },
      { status: 400 },
    );
  }

  console.log("[play-local] Endpoint hit");
  console.log("[play-local] Target:", target);
  console.log("[play-local] Browser preference:", browserPreference);

  const result = await runLocalPlaylist(target, browserPreference);
  console.log("[play-local] Command attempted:", result.command);
  console.log("[play-local] Fallback used:", result.fallbackUsed);

  if (result.success) {
    console.log("[play-local] Success");
    db.addLog({
      timestamp: new Date().toISOString(),
      level: "info",
      message: `Local playback: opened "${target}" (browser: ${browserPreference}, fallback: ${result.fallbackUsed ? "yes" : "no"}).`,
    });
    return NextResponse.json({
      ok: true,
      message: "Local playback command sent",
      browserPreference,
      command: result.command,
      fallbackUsed: result.fallbackUsed,
    });
  }

  console.error("[play-local] Failure:", result.error);
  db.addLog({
    timestamp: new Date().toISOString(),
    level: "error",
    message: `Local playback failed: ${result.error} (target: ${target}, browser: ${browserPreference}, fallback: ${result.fallbackUsed ? "yes" : "no"})`,
  });
  return NextResponse.json(
    {
      error: result.error,
      browserPreference,
      command: result.command,
      fallbackUsed: result.fallbackUsed,
    },
    { status: 500 },
  );
}
