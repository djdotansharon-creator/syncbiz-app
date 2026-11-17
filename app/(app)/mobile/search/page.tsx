"use client";

import { MobileSearchBar } from "@/components/mobile-search-bar";
import { MobileShazamImport } from "@/components/mobile/mobile-shazam-import";
import { MobileListenIdentify } from "@/components/mobile/mobile-listen-identify";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useTr } from "@/lib/i18n/use-tr";
import { useVmSongRoute } from "@/lib/use-vm-song-route";
import { VmPage, VmTarget } from "@/components/vm/vm-ui";

/**
 * SEARCH — find a song or a playlist (the business's own library first, then YouTube) and send it to the branch that is open.
 * Same search bar as before; what changed is WHERE a result goes: to the branch chosen in the chip (not to a player on this phone).
 */
export default function MobileSearchPage() {
  const { sources, contentScope, reload } = useMobileSources();
  const tr = useTr();
  const route = useVmSongRoute();

  return (
    <VmPage title={tr("Search")}>
      <VmTarget />
      <div style={{ padding: "12px 14px 0", display: "flex", flexDirection: "column", gap: 12 }}>
        <MobileSearchBar
          sources={sources}
          onAdd={() => reload()}
          onPlay={route.play}
          onSendToPlayer={route.play}
          onQueue={route.queue}
          variant="vm"
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
