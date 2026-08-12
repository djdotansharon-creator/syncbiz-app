import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { fetchElevenSharedVoices } from "@/lib/voice-lab";

export const dynamic = "force-dynamic";

/**
 * INTERNAL Voice Lab — ElevenLabs SHARED (community library) voice search, server-side paginated.
 * READ-ONLY / OFF-PLAYBACK. Separate from the base catalog so the library is never loaded in bulk:
 * the client requests one page at a time (Load more). Filters (language via locale, gender, search,
 * category, use_case) are applied by ElevenLabs, not the client.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const page = Number(sp.get("page") ?? "0");
  try {
    const result = await fetchElevenSharedVoices({
      locale: sp.get("locale") || "he-IL",
      page: Number.isFinite(page) ? page : 0,
      pageSize: 30,
      gender: sp.get("gender") || undefined,
      search: sp.get("search") || undefined,
      category: sp.get("category") || undefined,
      useCase: sp.get("use_case") || undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
