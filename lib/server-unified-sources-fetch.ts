import { headers } from "next/headers";
import { getApiBase } from "@/lib/api-base";
import type { UnifiedSource } from "@/lib/source-types";

/** Server Component fetch to unified API — forwards the browser Cookie header (internal fetch does not). */
export async function fetchUnifiedSourcesForServerComponent(): Promise<UnifiedSource[]> {
  try {
    const base = getApiBase();
    const h = await headers();
    const cookie = h.get("cookie");
    const res = await fetch(`${base}/api/sources/unified`, {
      cache: "no-store",
      headers: cookie ? { cookie } : {},
    });
    if (!res.ok) {
      console.error("[unified server fetch] API error:", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[unified server fetch] error:", e);
    return [];
  }
}
