"use client";

import { useMemo } from "react";
import { MobileSearchBar } from "@/components/mobile-search-bar";
import { MobileShazamImport } from "@/components/mobile/mobile-shazam-import";
import { MobileListenIdentify } from "@/components/mobile/mobile-listen-identify";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { VmPage, VmTarget, useVmUi } from "@/components/vm/vm-ui";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * SEARCH — find a song or a playlist (the business's own library first, then YouTube) and send it to the branch that is open.
 * Same search bar as before; what changed is WHERE a result goes: to the branch chosen in the chip (not to a player on this phone).
 */
export default function MobileSearchPage() {
  const { sources, contentScope, reload } = useMobileSources();
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();

  const route = useMemo(
    () => ({
      play: (u: UnifiedSource) => {
        if (!f.selected) return ui.openPicker();
        if (!f.canControl) return ui.toast(tr("{name} is offline", { name: f.selected.name }));
        f.playSource(u);
        ui.toast(tr("Playing on {name}", { name: f.selected.name }));
      },
      queue: (u: UnifiedSource) => {
        if (!f.selected) return ui.openPicker();
        if (!f.canControl) return ui.toast(tr("{name} is offline", { name: f.selected.name }));
        f.queueNext(u);
        ui.toast(tr("Will play next on {name}", { name: f.selected.name }));
      },
    }),
    [f, ui, tr],
  );

  return (
    <VmPage title={tr("Search")}>
      <VmTarget />
      <div style={{ padding: "12px 14px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        <MobileSearchBar
          sources={sources}
          onAdd={() => reload()}
          onPlay={route.play}
          onSendToPlayer={route.play}
          placeholder={tr("Search songs and playlists…")}
          isControllerMode
          editReturnTo="/mobile/search"
          unifiedContentScope={contentScope}
          hideRadio
        />
        {/* one-tap mic identify (records → recognizes → lines it up next on the open branch) */}
        <MobileListenIdentify route={route} />
        {/* a Shazam link */}
        <MobileShazamImport variant="hero" route={route} />
      </div>
    </VmPage>
  );
}
