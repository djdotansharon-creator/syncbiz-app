import { Suspense } from "react";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import { SourcesManager } from "@/components/sources-manager";
import { fetchUnifiedSourcesForServerComponent } from "@/lib/server-unified-sources-fetch";

export default async function SourcesPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const allSources = await fetchUnifiedSourcesForServerComponent();
  const sources = allSources.filter((s) => s.origin !== "radio");

  return (
    <div className="space-y-0">
      <Suspense fallback={<div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500">{t.loadingSources}</div>}>
        <SourcesManager initialSources={sources} pageTitle={t.libraryPageTitle} pageSubtitle={t.libraryPageSubtitle} />
      </Suspense>
    </div>
  );
}
