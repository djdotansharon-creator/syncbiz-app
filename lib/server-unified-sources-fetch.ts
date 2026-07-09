import { headers } from "next/headers";
import { getApiBase } from "@/lib/api-base";
import type { UnifiedSource } from "@/lib/source-types";

/** Server Component fetch to unified API — forwards the browser Cookie header (internal fetch does not). */
export async function fetchUnifiedSourcesForServerComponent(): Promise<UnifiedSource[]> {
  try {
    const base = getApiBase();
    const h = await headers();
    const cookie = h.get("cookie");
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 75_000); // 75s — generous for slow dev DB
    try {
      const res = await fetch(`${base}/api/sources/unified`, {
        cache: "no-store",
        headers: cookie ? { cookie } : {},
        signal: controller.signal,
      });
      if (!res.ok) {
        // Use warn (not error) so the Next.js dev overlay doesn't flash red on transient DB pressure.
        console.warn("[unified server fetch] API unavailable:", res.status);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (e) {
    console.warn("[unified server fetch] skipped:", (e as Error)?.message ?? e);
    return [];
  }
}
