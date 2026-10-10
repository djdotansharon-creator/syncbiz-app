"use client";

import { BranchMap, type MapBranch } from "@/components/control-room/branch-map";

/** CONTROL ROOM — always the light built-in map (owner decision 2026-10-11: no Google Maps tiles in the Control Room). */
export function NetworkMap({ branches, selectedId, onSelect }: { branches: MapBranch[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return <BranchMap branches={branches} selectedId={selectedId} onSelect={onSelect} />;
}
