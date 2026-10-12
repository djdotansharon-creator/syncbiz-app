"use client";

import { BranchMap, type MapBranch, type MapRegions } from "@/components/control-room/branch-map";

/** CONTROL ROOM — always the light built-in map (owner decision 2026-10-11: no Google Maps tiles in the Control Room). */
export function NetworkMap({ branches, selectedId, onSelect, regions, height, controlsSlot }: { branches: MapBranch[]; selectedId: string | null; onSelect: (id: string) => void; regions?: MapRegions; height?: number | string; controlsSlot?: HTMLElement | null }) {
  return <BranchMap branches={branches} selectedId={selectedId} onSelect={onSelect} regions={regions} height={height} controlsSlot={controlsSlot} />;
}
