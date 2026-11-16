"use client";

import { useMemo, useState } from "react";
import { useMobileSources } from "@/lib/mobile-sources-context";
import { useTr } from "@/lib/i18n/use-tr";
import { VmPage, VmTarget } from "@/components/vm/vm-ui";
import { VmSourceRow } from "@/components/vm/vm-source-row";
import { IconLibrary, IconSearch } from "@/components/vm/vm-icons";

/**
 * LIBRARY — the playlists and songs of the business, to send to the branch that is open (the chip at the top says which).
 * Categories keep the old meaning: Ready = the ready-made lists (`libraryPlacement === "ready_external"`), Mine = everything the business made or added.
 * Radio stays out of the phone (as before).
 */
const PAGE = 60;

export default function MobileLibraryPage() {
  const { sources, status, error, reload } = useMobileSources();
  const tr = useTr();
  const [cat, setCat] = useState<"all" | "ready" | "mine">("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return sources.filter((s) => {
      if (s.origin === "radio") return false;
      const ready = s.origin === "playlist" && s.playlist?.libraryPlacement === "ready_external";
      if (cat === "ready" && !ready) return false;
      if (cat === "mine" && ready) return false;
      return !t || s.title.toLowerCase().includes(t);
    });
  }, [sources, cat, q]);

  return (
    <VmPage title={tr("Library")}>
      <VmTarget />
      <div className="vm-chips" role="tablist" aria-label={tr("Library")}>
        {(["all", "ready", "mine"] as const).map((c) => (
          <button key={c} type="button" role="tab" aria-selected={cat === c} className="vm-chip" data-on={cat === c ? "" : undefined} onClick={() => { setCat(c); setLimit(PAGE); }}>
            {c === "all" ? tr("All") : c === "ready" ? tr("Ready-made") : tr("Mine")}
          </button>
        ))}
      </div>
      <label className="vm-field">
        <IconSearch />
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder={tr("Filter your library")} />
      </label>

      <div style={{ marginTop: 10 }}>
        {status === "loading" && !sources.length ? (
          <div className="vm-list" style={{ marginTop: 10 }} aria-busy>
            <div className="vm-skel" />
            <div className="vm-skel" />
            <div className="vm-skel" />
          </div>
        ) : status === "error" ? (
          <div className="vm-empty">
            <h2>{tr("Couldn't load the library")}</h2>
            <span>{error}</span>
            <button type="button" className="vm-pill" onClick={reload}>{tr("Try again")}</button>
          </div>
        ) : !rows.length ? (
          <div className="vm-empty">
            <IconLibrary />
            <h2>{q ? tr("Nothing found") : tr("Your library is empty")}</h2>
            <span>{q ? tr("Try another word.") : tr("Playlists you add on the computer, or find with Search, appear here.")}</span>
          </div>
        ) : (
          <>
            {rows.slice(0, limit).map((s) => (
              <VmSourceRow key={`${s.origin}:${s.id}`} source={s} href={s.origin === "playlist" ? `/mobile/library/playlist/${encodeURIComponent(s.id)}` : null} />
            ))}
            {rows.length > limit ? (
              <div className="vm-more">
                <button type="button" className="vm-pill" data-quiet onClick={() => setLimit((n) => n + PAGE)}>
                  {tr("Show more")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </VmPage>
  );
}
