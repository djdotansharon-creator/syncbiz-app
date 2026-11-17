"use client";

import { useMemo } from "react";
import { useMobileFleet } from "@/lib/mobile-fleet";
import { useTr } from "@/lib/i18n/use-tr";
import { useVmUi } from "@/components/vm/vm-ui";
import type { UnifiedSource } from "@/lib/source-types";

/**
 * WHERE A SONG GOES in the phone app — the one rule shared by Search and "Identify a song": a song is sent to the branch that is OPEN (chosen in the chip), never to a player on
 * this phone. No branch chosen → the picker opens; the branch is offline → a short note and nothing is sent.
 */
export function useVmSongRoute(): { play: (u: UnifiedSource) => void; queue: (u: UnifiedSource) => void } {
  const f = useMobileFleet();
  const tr = useTr();
  const ui = useVmUi();
  return useMemo(
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
}
