import { Suspense } from "react";
import { getApiBase } from "@/lib/api-base";
import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import { RadioStreamsManager } from "@/components/radio-streams-manager";
import type { RadioStream } from "@/lib/source-types";

async function getRadioStations(): Promise<RadioStream[]> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/radio`, { cache: "no-store" });
  return res.json();
}

export default async function RadioPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const stations = await getRadioStations();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">{t.radioPageTitle}</h1>
        <p className="mt-1 text-sm text-slate-400">{t.radioPageSubtitle}</p>
      </div>
      <Suspense
        fallback={
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500">
            Loading…
          </div>
        }
      >
        <RadioStreamsManager initialStations={stations} />
      </Suspense>
    </div>
  );
}
