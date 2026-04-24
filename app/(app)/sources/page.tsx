import { getLocale } from "@/lib/locale-server";
import { getTranslations } from "@/lib/translations";
import { fetchUnifiedSourcesForServerComponent } from "@/lib/server-unified-sources-fetch";
import { SourcesManagerClient } from "@/components/sources-manager-client";

export default async function SourcesPage() {
  const locale = await getLocale();
  const t = getTranslations(locale);
  const allSources = await fetchUnifiedSourcesForServerComponent();
  const sources = allSources.filter((s) => s.origin !== "radio");

  return (
    <div className="space-y-0">
      <SourcesManagerClient
        initialSources={sources}
        pageTitle={t.libraryPageTitle}
        pageSubtitle={t.libraryPageSubtitle}
      />
    </div>
  );
}
