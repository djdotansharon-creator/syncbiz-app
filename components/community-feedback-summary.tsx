"use client";

/**
 * READ-ONLY "Community feedback" zone for the now-playing track. Shows the aggregated, public,
 * non-identifying signal from users' "Suggest info" submissions (⭐ great-track count, agreed
 * genres/moods, contributor count). It NEVER edits anything and NEVER shows private data — it just
 * surfaces the separate feedback layer that also feeds the DJ-AI as a soft ranking hint.
 */

import { useEffect, useState, type ReactElement } from "react";

type ChipCount = { label: string; count: number };
type Summary = {
  contributorCount: number;
  greatCount: number;
  genres: ChipCount[];
  moods: ChipCount[];
  tags: ChipCount[];
};

export function CommunityFeedbackSummary({ catalogItemId }: { catalogItemId?: string | null }): ReactElement | null {
  const [data, setData] = useState<Summary | null>(null);

  useEffect(() => {
    if (!catalogItemId) { setData(null); return; }
    let alive = true;
    fetch(`/api/contributions/summary?catalogItemId=${encodeURIComponent(catalogItemId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setData(j && typeof j.contributorCount === "number" ? (j as Summary) : null); })
      .catch(() => { if (alive) setData(null); });
    return () => { alive = false; };
  }, [catalogItemId]);

  if (!data || data.contributorCount < 1) return null;

  const chips = [...data.genres, ...data.moods].slice(0, 4);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
      <span className="font-semibold uppercase tracking-wide text-slate-500">Community</span>
      {data.greatCount > 0 ? (
        <span className="inline-flex items-center gap-0.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 font-medium text-amber-300">
          ⭐ {data.greatCount}
        </span>
      ) : null}
      {chips.map((c) => (
        <span key={c.label} className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-slate-300">
          {c.label}{c.count > 1 ? ` ·${c.count}` : ""}
        </span>
      ))}
      <span className="text-slate-500">
        {data.contributorCount} contributor{data.contributorCount === 1 ? "" : "s"}
      </span>
    </div>
  );
}
