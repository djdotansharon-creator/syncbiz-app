"use client";

import { useMemo } from "react";
import { ISRAEL_OUTLINE, cityLngLat, makeProjection } from "@/lib/control-room-geo";

/** CONTROL ROOM — map of the network: one dot per branch (placed by city), colored by live status. Display only. */

export type MapDotStatus = "playing" | "idle" | "offline" | "install" | "unknown";

export type MapBranch = { id: string; name: string; city: string; status: MapDotStatus };

const W = 260;
const H = 520;

export const DOT_FILL: Record<MapDotStatus, string> = {
  playing: "var(--sb-accent)",
  idle: "#34d399",
  offline: "rgba(255,255,255,0.35)",
  install: "#fbbf24",
  unknown: "rgba(255,255,255,0.2)",
};

export function BranchMap({
  branches,
  selectedId,
  onSelect,
}: {
  branches: MapBranch[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const project = useMemo(() => makeProjection(W, H), []);
  const outline = useMemo(
    () => ISRAEL_OUTLINE.map((p, i) => `${i === 0 ? "M" : "L"}${project(p).map((v) => v.toFixed(1)).join(",")}`).join(" ") + " Z",
    [project],
  );
  const dots = useMemo(
    () =>
      branches
        .map((b) => {
          const at = cityLngLat(b.city);
          return at ? { ...b, xy: project(at) } : null;
        })
        .filter((d): d is MapBranch & { xy: [number, number] } => d !== null),
    [branches, project],
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full max-h-[560px] w-full" role="img" aria-label="Branch map">
      <path d={outline} fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" strokeWidth={1} strokeLinejoin="round" />
      {dots.map((d) => {
        const selected = d.id === selectedId;
        return (
          <g key={d.id} className="cursor-pointer" onClick={() => onSelect(d.id)}>
            <title>{d.name}</title>
            {selected ? <circle cx={d.xy[0]} cy={d.xy[1]} r={9} fill="none" stroke="#fff" strokeWidth={1.5} /> : null}
            {d.status === "playing" ? (
              <circle cx={d.xy[0]} cy={d.xy[1]} r={5} fill={DOT_FILL.playing} opacity={0.35}>
                <animate attributeName="r" values="5;11;5" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.35;0;0.35" dur="2.4s" repeatCount="indefinite" />
              </circle>
            ) : null}
            <circle cx={d.xy[0]} cy={d.xy[1]} r={5} fill={DOT_FILL[d.status]} />
          </g>
        );
      })}
    </svg>
  );
}
