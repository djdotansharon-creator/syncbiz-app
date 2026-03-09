import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import type { Source } from "@/lib/types";
import { AddSourceForm } from "@/components/add-source-form";
import { SourceCard } from "@/components/source-card";

async function getSources(): Promise<Source[]> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/sources`, { cache: "no-store" });
  return res.json();
}

export default async function SourcesPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const sources = await getSources();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{t.sources}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {t.sourcesSubtitle}
        </p>
      </div>

      <AddSourceForm />

      <section>
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-500">
          {t.library}
        </h2>
        {sources.length === 0 ? (
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/40 py-16 text-center text-sm text-slate-500">
            {t.noSourcesYet}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
