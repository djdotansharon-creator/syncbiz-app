"use client";

import dynamic from "next/dynamic";
import { PlayerBranchModePanel } from "@/components/player-branch-mode-panel";
import { useTranslations } from "@/lib/locale-context";

const SourcesManager = dynamic(
  () => import("@/components/sources-manager").then((m) => m.SourcesManager),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-12 text-center text-slate-500">Loading…</div>
    ),
  },
);

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
