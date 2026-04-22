"use client";

import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileSearchBar } from "@/components/mobile-search-bar";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useMobileRole } from "@/lib/mobile-role-context";
import { useStationController } from "@/lib/station-controller-context";
import { usePlayback } from "@/lib/playback-provider";

/**
 * Mobile Search: reuses the existing MobileSearchBar (results panel, add + play flows) and
 * wires its callbacks to Controller or Player based on the current mobile role.
 *
 * The search bar is sticky directly under the header so the input stays accessible while
 * results / suggestions scroll.
 */
export default function MobileSearchPage() {
  const { sources, contentScope, addSource, replaceSource, reload } = useMobileSources();
  const { mobileRole } = useMobileRole();
  const station = useStationController();
  const { playSource } = usePlayback();

  const isController = mobileRole === "controller";
  const playHandler = isController ? station.sendPlaySource : playSource;
  const addHandler = isController ? () => reload() : addSource;

  return (
    <>
      <MobilePageHeader title="Search" showModePill />
      <div className="px-4 pt-3 pb-6">
        <MobileSearchBar
          sources={sources}
          onAdd={addHandler}
          onPlay={playHandler}
          onSendToPlayer={playHandler}
          onReplaceSource={isController ? undefined : replaceSource}
          placeholder="Search library or discover playlists…"
          isControllerMode={isController}
          editReturnTo="/mobile/search"
          unifiedContentScope={contentScope}
        />
      </div>
    </>
  );
}
