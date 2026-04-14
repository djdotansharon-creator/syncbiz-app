"use client";

import { SourcesManager } from "@/components/sources-manager";
import { PlayerBranchModePanel } from "@/components/player-branch-mode-panel";
import { useTranslations } from "@/lib/locale-context";

export function RemotePlayerPage() {
  const { t } = useTranslations();

  return (
    <div className="space-y-4">
      <PlayerBranchModePanel />
      <SourcesManager
        initialSources={[]}
        pageTitle={t.remotePlayer ?? "Remote Player"}
        pageSubtitle={t.remotePlayerSubtitle ?? "Same player UI – MASTER or CONTROL mode"}
      />
    </div>
  );
}
