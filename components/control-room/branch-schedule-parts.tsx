"use client";

/**
 * CONTROL ROOM — the small shared parts of the Schedule section (owner 2026-11-25, phase 2): the business's branches (id + name, one shared read) and the read-only LANE of one day.
 * Both the section (branch-schedule.tsx) and its two windows (branch-schedule-dialogs.tsx) use them — so they live here, and nothing imports in a circle.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import { useTr } from "@/lib/i18n/use-tr";
import { formatMinutes, tickStep, windowTicks } from "@/lib/schedules-timeline";
import { laneBox, laneRange, laneTimes, type LaneBlock } from "@/lib/branch-schedule-lane";

// ── small shared reads (one request, shared by a quick re-open) ──────────────────────────────────────────────────────────────────────────────────────────────────

export type BranchLite = { id: string; name: string };

export const SHARE_MS = 20_000;
let branchesShared: { at: number; value: Promise<BranchLite[]> } | null = null;
/** the business's branches (id + name) — for "from <branch>" and for the checklist of the send window */
function loadBranches(): Promise<BranchLite[]> {
  if (branchesShared && Date.now() - branchesShared.at < SHARE_MS) return branchesShared.value;
  const value = (async (): Promise<BranchLite[]> => {
    try {
      const r = await fetch("/api/branches", { credentials: "include", cache: "no-store" });
      if (!r.ok) return [];
      const j = (await r.json()) as unknown;
      return Array.isArray(j) ? (j as BranchLite[]).filter((b) => b && typeof b.id === "string" && typeof b.name === "string").map((b) => ({ id: b.id, name: b.name })) : [];
    } catch {
      return [];
    }
  })();
  branchesShared = { at: Date.now(), value };
  return value;
}

/** the branches, or null while they load */
export function useBranches(): BranchLite[] | null {
  const [list, setList] = useState<BranchLite[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBranches().then((v) => { if (alive) setList(v); });
    return () => { alive = false; };
  }, []);
  return list;
}


// ── the lane ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => {
      const x = es[0]?.contentRect.width;
      if (x) setW(Math.round(x));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/**
 * ONE day as a lane — read only: no handlers, nothing to drag. Music blocks are soft tinted, quiet blocks hatched, the closing quieter still. A block too narrow for its name is listed under the lane
 * (so every block can be read), and each one carries its time in a tooltip and in its accessible name.
 */
export function DayLane({ blocks, label, compact = false }: { blocks: LaneBlock[]; label: string; compact?: boolean }): ReactElement {
  const tr = useTr();
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const range = useMemo(() => laneRange(blocks), [blocks]);
  const span = Math.max(1, range.last - range.first);
  const ticks = useMemo(() => windowTicks({ a: range.first, b: range.last }, tickStep(width / span, 44)), [range, width, span]);
  const minPx = compact ? 46 : 60;
  const boxes = blocks.map((b) => ({ b, box: laneBox(b, range) }));
  const narrow = boxes.filter((x) => (x.box.width / 100) * width < minPx);
  return (
    <div className={`cr-sch-lane${compact ? " is-compact" : ""}`} dir="ltr">
      <div ref={ref} className="cr-sch-track" role="list" aria-label={label}>
        {ticks.map((m) => (
          <i key={m} className="cr-sch-grid" style={{ insetInlineStart: `${((m - range.first) / span) * 100}%` }} aria-hidden />
        ))}
        {boxes.map(({ b, box }) => {
          const isNarrow = (box.width / 100) * width < minPx;
          const name = b.name || tr("Music");
          return (
            <div
              key={b.key}
              role="listitem"
              className={`cr-sch-b${b.quiet ? " is-quiet" : ""}${b.closing ? " is-closing" : ""}`}
              data-tone={b.tone}
              style={{ insetInlineStart: `calc(${box.left}% + 1px)`, width: `calc(${box.width}% - 2px)` }}
              title={`${laneTimes(b)} · ${name}`}
              aria-label={`${name}, ${laneTimes(b)}`}
            >
              {isNarrow ? null : (
                <>
                  <span className="cr-sch-b-name" dir="auto">{name}</span>
                  {compact ? null : <span className="cr-sch-b-time">{formatMinutes(b.start)}</span>}
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="cr-sch-axis" aria-hidden>
        {ticks.map((m) => (
          <span key={m} style={{ insetInlineStart: `${((m - range.first) / span) * 100}%` }}>{formatMinutes(m)}</span>
        ))}
      </div>
      {narrow.length > 0 ? (
        <ul className="cr-sch-small" dir="auto">
          {narrow.map(({ b }) => (
            <li key={b.key}><bdi className="cr-sch-small-time">{formatMinutes(b.start)}</bdi> <bdi>{b.name || tr("Music")}</bdi></li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

