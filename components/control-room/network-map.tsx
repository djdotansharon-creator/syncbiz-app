"use client";

import { useState } from "react";
import { useMapsConfig } from "@/lib/google-maps-client";
import { BranchMap, type MapBranch } from "@/components/control-room/branch-map";
import { GoogleBranchMap } from "@/components/control-room/google-branch-map";

/** CONTROL ROOM — Google Maps when the browser key is configured; otherwise (or if Google fails) the built-in map. */
export function NetworkMap({ branches, selectedId, onSelect }: { branches: MapBranch[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const cfg = useMapsConfig();
  const [googleFailed, setGoogleFailed] = useState(false);
  if (cfg?.browserKey && !googleFailed) {
    return (
      <GoogleBranchMap
        branches={branches}
        selectedId={selectedId}
        onSelect={onSelect}
        browserKey={cfg.browserKey}
        mapId={cfg.mapId}
        onFailed={() => setGoogleFailed(true)}
      />
    );
  }
  return <BranchMap branches={branches} selectedId={selectedId} onSelect={onSelect} />;
}
