import { Suspense } from "react";
import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import { FavoritesManager } from "@/components/favorites-manager";
import type { UnifiedSource } from "@/lib/source-types";

async function getUnifiedSources(): Promise<UnifiedSource[]> {
  try {
    const base = getApiBase();
    const res = await fetch(`${base}/api/sources/unified`, { cache: "no-store" });
    if (!res.ok) {
      console.error("[favorites] API error:", res.status, await res.text());
      return [];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[favorites] getUnifiedSources error:", e);
    return [];
  }
}

export default async function FavoritesPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const sources = await getUnifiedSources();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{t.favorites}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t.favoritesPageSubtitle}
        </p>
      </div>
      <Suspense fallback={<div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500">{t.loadingSources}</div>}>
        <FavoritesManager allSources={sources} />
      </Suspense>
    </div>
  );
}
