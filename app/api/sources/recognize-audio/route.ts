import { NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";

// Uses Node fetch + FormData to call AudD; keep on the Node runtime.
export const runtime = "nodejs";

const AUDD_ENDPOINT = "https://api.audd.io/";

/**
 * In-app song recognition. The client records a short clip from the microphone
 * and POSTs it here as `audio` (multipart). We forward it to AudD with the
 * server-only AUDD_API_TOKEN and return only the recognized artist/title — the
 * caller then runs the EXISTING YouTube resolver. The AudD token never reaches
 * the client. Auth-gated so it can't be abused to burn recognition credits.
 *
 * Returns { ok: true, artist, title } | { ok: false, reason }.
 */
export async function POST(req: Request) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });

  const token = (process.env.AUDD_API_TOKEN ?? "").trim();
  if (!token) return NextResponse.json({ ok: false, reason: "not_configured" });

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    if (f instanceof File && f.size > 0) audio = f;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  if (!audio) return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  // Guard against oversized uploads (a 7s clip is well under this).
  if (audio.size > 6 * 1024 * 1024) return NextResponse.json({ ok: false, reason: "too_large" }, { status: 413 });

  const out = new FormData();
  out.append("api_token", token);
  out.append("file", audio, audio.name || "clip");

  let res: Response;
  try {
    res = await fetch(AUDD_ENDPOINT, { method: "POST", body: out, signal: AbortSignal.timeout(20000) });
  } catch {
    return NextResponse.json({ ok: false, reason: "service_error" });
  }
  if (!res.ok) return NextResponse.json({ ok: false, reason: "service_error" });

  const data = (await res.json().catch(() => null)) as
    | { status?: string; result?: { artist?: string; title?: string } | null; error?: { error_message?: string } }
    | null;

  if (!data || data.status !== "success") {
    return NextResponse.json({ ok: false, reason: "service_error" });
  }
  if (!data.result) {
    return NextResponse.json({ ok: false, reason: "not_found" });
  }
  const artist = (data.result.artist ?? "").trim();
  const title = (data.result.title ?? "").trim();
  if (!artist && !title) return NextResponse.json({ ok: false, reason: "not_found" });

  return NextResponse.json({ ok: true, artist, title });
}
