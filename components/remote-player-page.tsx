"use client";

import { Suspense } from "react";
import { SourcesManager } from "@/components/sources-manager";
import { useTranslations } from "@/lib/locale-context";

export function RemotePlayerPage() {
  const { t } = useTranslations();

  return (
    <div className="space-y-4">
      <SourcesManager
        initialSources={[]}
        pageTitle={t.remotePlayer ?? "Remote Player"}
        pageSubtitle={t.remotePlayerSubtitle ?? "Same player UI – MASTER or CONTROL mode"}
      />
    </div>
  );
}
