"use client";

/**
 * Music Library Metadata — the daily-management screen that replaces the Excel juggling.
 * Two visible layers per row:
 *   • Original MP3 Metadata — LOCKED, read-only mirror of the music file (never editable here).
 *   • SyncBiz Enrichment    — editable, saved to Postgres only. NEVER written back to a file.
 * "Refresh From Music Bank" re-reads files into Layer A only; enrichment is left untouched.
 * Default columns stay simple; technical fields live behind "Details".
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

type Enrichment = {
  myComment: string | null; myTags: string[]; scope: string; manualSelected: boolean | null;
  mood: string | null; energy: string | null; notes: string | null; customFields: Record<string, unknown> | null;
} | null;

type Row = {
  id: string; localRef: string; filename: string; availability: string;
  original: {
    title: string | null; artists: string[]; album: string | null; genres: string[];
    year: number | null; bpm: number | null; comments: string[]; displayComment: string;
    rating: number | null; isrc: string[]; customTags: Record<string, unknown> | null;
    metadataHash: string | null; lastReadAt: string; locked: true;
  };
  enrichment: Enrichment;
  effective: { selected: boolean; genre: string | null; bpm: number | null; rating: number | null };
  scope: string; hasComment: boolean; hasManualEnrichment: boolean;
  possibleTypos: { rawToken: string; suggestedMeaning: string; confidence: string }[];
};

type CustomField = { id: string; name: string; label: string; type: string; allowedOptions: string[]; active: boolean };
type Typo = { rawToken: string; suggestedMeaning: string | null; category: string; occurrences: number; approved: boolean };
type ApiResp = { rows: Row[]; customFields: CustomField[]; typos: Typo[]; total: number; source: string | null; error?: string };
type RefreshPlan = {
  musicFilesRead: number; created: string[]; updated: string[]; unchanged: string[]; missing: string[];
  syncbizDbChangesProposed: number; enrichmentPreserved: number; musicFilesModified: number;
};

const SCOPES = ["GENERAL", "CLIENT_SPECIFIC", "EVENT_SPECIFIC", "INTERNAL", "REVIEW", "IGNORE"];
const API = "/api/music-library/metadata";

export function MusicLibraryMetadataWorkspacePanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [typoOnly, setTypoOnly] = useState(false);
  const [manualOnly, setManualOnly] = useState(false);
  const [refreshPlan, setRefreshPlan] = useState<RefreshPlan | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [forbidden, setForbidden] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (search.trim()) p.set("search", search.trim());
    if (selectedOnly) p.set("selected", "true");
    if (scopeFilter) p.set("scope", scopeFilter);
    if (typoOnly) p.set("possibleTypo", "true");
    if (manualOnly) p.set("hasManualEnrichment", "true");
    return p.toString();
  }, [search, selectedOnly, scopeFilter, typoOnly, manualOnly]);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`${API}?${query}`, { cache: "no-store" });
      if (r.status === 403) { setForbidden(true); setData(null); return; }
      const j: ApiResp = await r.json();
      if (j.error) throw new Error(j.error);
      setForbidden(false);
      setData(j);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [query]);

  useEffect(() => { const t = setTimeout(load, 180); return () => clearTimeout(t); }, [load]);

  const patch = useCallback(async (row: Row, p: Record<string, unknown>) => {
    setSaving(row.id);
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-enrichment", localFileId: row.id, patch: p }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      await load();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(null); }
  }, [load]);

  const refresh = useCallback(async () => {
    if (!data) return;
    setRefreshing(true); setRefreshPlan(null);
    const reads = data.rows.map((r) => ({
      localRef: r.localRef, filename: r.filename, originalTitle: r.original.title, originalArtists: r.original.artists,
      originalAlbum: r.original.album, originalGenres: r.original.genres, originalYear: r.original.year, originalBpm: r.original.bpm,
      originalComments: r.original.comments, originalRating: r.original.rating, originalIsrc: r.original.isrc, originalCustomTags: r.original.customTags,
    }));
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh", apply: false, reads }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setRefreshPlan(j.plan);
    } catch (e) { setErr((e as Error).message); } finally { setRefreshing(false); }
  }, [data]);

  const toggleExpand = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const unresolvedTypos = data?.typos.filter((t) => !t.approved) ?? [];

  // ADMIN-only surface: a non-admin who reaches this panel gets a 403, never the data/controls.
  if (forbidden) {
    return (
      <div className="sb-anim-rise flex flex-col w-full max-h-[min(85vh,760px)] rounded-2xl border border-[var(--sb-border,#2a2a2e)] bg-[var(--sb-surface,#141416)] text-[var(--sb-text,#eee)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--sb-border,#2a2a2e)]">
          <h2 className="text-[15px] font-semibold tracking-tight">Music Library Metadata</h2>
          <button onClick={onClose} className="text-[13px] px-2.5 py-1.5 rounded-lg hover:bg-white/5" aria-label="Close">✕</button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
          <div className="text-[28px]">🔒</div>
          <div className="text-[15px] font-semibold">403 — Admin only</div>
          <p className="text-[12px] text-[var(--sb-text-dim,#8a8a90)] max-w-[360px]">This is an internal administration area. Your account doesn’t have access.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="sb-anim-rise flex flex-col w-full max-h-[min(85vh,760px)] rounded-2xl border border-[var(--sb-border,#2a2a2e)] bg-[var(--sb-surface,#141416)] text-[var(--sb-text,#eee)] overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--sb-border,#2a2a2e)]">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">Music Library Metadata</h2>
          <p className="text-[11px] text-[var(--sb-text-dim,#8a8a90)]">Original tags are read-only, mirrored from the music bank. Your edits live in SyncBiz only — never written back to a music file.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={refreshing} className="text-[12px] px-3 py-1.5 rounded-lg border border-[var(--sb-border,#2a2a2e)] hover:bg-white/5 disabled:opacity-50">↻ Refresh From Music Bank</button>
          <button onClick={onClose} className="text-[13px] px-2.5 py-1.5 rounded-lg hover:bg-white/5" aria-label="Close">✕</button>
        </div>
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-[var(--sb-border,#2a2a2e)]">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search artist, title, filename, comment, tags…"
          className="flex-1 min-w-[220px] text-[13px] px-3 py-1.5 rounded-lg bg-black/30 border border-[var(--sb-border,#2a2a2e)] outline-none focus:border-[#0a84ff]" />
        <Chip active={selectedOnly} onClick={() => setSelectedOnly((v) => !v)}>SELECTED</Chip>
        <Chip active={manualOnly} onClick={() => setManualOnly((v) => !v)}>Has enrichment</Chip>
        <Chip active={typoOnly} onClick={() => setTypoOnly((v) => !v)}>Possible typo</Chip>
        <select value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} className="text-[12px] px-2 py-1.5 rounded-lg bg-black/30 border border-[var(--sb-border,#2a2a2e)]">
          <option value="">All scopes</option>
          {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* refresh preview — precise, itemised, read-only */}
      {refreshPlan && (
        <div className="px-5 py-2.5 text-[12px] bg-[#0a84ff]/10 border-b border-[var(--sb-border,#2a2a2e)]">
          <div className="font-medium text-[#4aa3ff] mb-1">Refresh preview — no music file was modified.</div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-1 text-[var(--sb-text,#eee)]">
            <Stat label="Music files read" value={refreshPlan.musicFilesRead} />
            <Stat label="Original metadata changes" value={refreshPlan.created.length + refreshPlan.updated.length} />
            <Stat label="SyncBiz DB changes proposed" value={refreshPlan.syncbizDbChangesProposed} />
            <Stat label="Enrichment preserved" value={refreshPlan.enrichmentPreserved} />
            <Stat label="Music files modified" value={refreshPlan.musicFilesModified} accent />
          </div>
          <div className="mt-1.5 text-[11px] text-[var(--sb-text-dim,#8a8a90)]">Original metadata was read from the music bank. SyncBiz enrichment is stored only in SyncBiz. Preview is read-only — nothing was applied.</div>
        </div>
      )}
      {unresolvedTypos.length > 0 && (
        <div className="px-5 py-2 text-[12px] text-amber-300 bg-amber-500/10 border-b border-[var(--sb-border,#2a2a2e)]">
          Needs review — possible typos: {unresolvedTypos.map((t) => `${t.rawToken} → ${t.suggestedMeaning} (×${t.occurrences})`).join(", ")}. Not auto-applied.
        </div>
      )}
      {err && <div className="px-5 py-2 text-[12px] text-red-400 bg-red-500/10 border-b border-[var(--sb-border,#2a2a2e)]">{err}</div>}

      {/* table — simple default columns; technical fields behind Details */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 bg-[var(--sb-surface,#141416)] z-10">
            <tr className="text-left text-[11px] text-[var(--sb-text-dim,#8a8a90)]">
              <Th className="pl-5">Artist</Th><Th>Title</Th><Th>Original Genre</Th><Th>Original Comment</Th>
              <Th>SELECTED</Th><Th>My Tags</Th><Th>Scope</Th><Th>Availability</Th><Th className="pr-5"></Th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => {
              const isOpen = expanded.has(row.id);
              return (
              <Fragment key={row.id}>
                <tr className="border-t border-[var(--sb-border,#2a2a2e)] align-top hover:bg-white/[0.02]">
                  <td className="pl-5 py-2 pr-3 max-w-[160px] truncate text-[var(--sb-text-dim,#c8c8ce)]" title={row.original.artists.join(", ")}>{row.original.artists.join(", ") || "—"}</td>
                  <td className="py-2 pr-3 max-w-[200px]"><div className="truncate font-medium" title={row.original.title ?? row.filename}>{row.original.title ?? row.filename}</div></td>
                  <td className="py-2 pr-3 text-[var(--sb-text-dim,#9a9aa0)]">{row.original.genres[0] ?? "—"}</td>
                  <td className="py-2 pr-3 max-w-[220px] text-[var(--sb-text-dim,#9a9aa0)]">
                    {row.original.comments.length === 0 ? <span className="opacity-40">—</span> : (
                      <div className="flex flex-col gap-0.5">{row.original.comments.map((c, i) => <span key={i} className="truncate" title={c}>{c}</span>)}</div>
                    )}
                    {row.possibleTypos.length > 0 && <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">typo?: {row.possibleTypos.map((t) => t.rawToken).join(", ")}</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <select value={row.enrichment?.manualSelected == null ? "auto" : row.enrichment.manualSelected ? "yes" : "no"}
                      onChange={(e) => patch(row, { manualSelected: e.target.value === "auto" ? null : e.target.value === "yes" })}
                      className={`text-[12px] px-1.5 py-1 rounded bg-black/30 border ${row.effective.selected ? "border-[#0a84ff] text-[#0a84ff]" : "border-[var(--sb-border,#2a2a2e)]"}`}>
                      <option value="auto">auto ({row.effective.selected ? "✓" : "—"})</option>
                      <option value="yes">force ✓</option>
                      <option value="no">force ✗</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3 min-w-[150px]">
                    <input defaultValue={(row.enrichment?.myTags ?? []).join(", ")} placeholder="tag, tag…"
                      onBlur={(e) => { const tags = e.target.value.split(",").map((t) => t.trim()).filter(Boolean); if (JSON.stringify(tags) !== JSON.stringify(row.enrichment?.myTags ?? [])) patch(row, { myTags: tags }); }}
                      className="w-full text-[12px] px-2 py-1 rounded bg-black/30 border border-transparent hover:border-[var(--sb-border,#2a2a2e)] focus:border-[#0a84ff] outline-none" />
                  </td>
                  <td className="py-2 pr-3">
                    <select value={row.scope} onChange={(e) => patch(row, { scope: e.target.value })} className="text-[12px] px-1.5 py-1 rounded bg-black/30 border border-[var(--sb-border,#2a2a2e)]">
                      {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="py-2 pr-3 text-[11px]">
                    {row.availability === "missing" ? <span className="text-red-400">missing</span> : <span className="text-[var(--sb-text-dim,#8a8a90)]">available</span>}
                    {saving === row.id && <span className="ml-1 text-[#0a84ff]">saving…</span>}
                  </td>
                  <td className="py-2 pr-5">
                    <button onClick={() => toggleExpand(row.id)} className="text-[11px] px-1.5 py-0.5 rounded hover:bg-white/10 text-[var(--sb-text-dim,#8a8a90)]">{isOpen ? "▾ Details" : "▸ Details"}</button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-black/20 border-t border-[var(--sb-border,#2a2a2e)]">
                    <td colSpan={9} className="px-5 py-3">
                      <div className="grid md:grid-cols-2 gap-6">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-[var(--sb-text-dim,#6a6a70)] mb-1.5">🔒 Original — read-only (from the music file)</div>
                          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-[11px] text-[var(--sb-text-dim,#a8a8ae)]">
                            <Adv k="Filename">{row.filename}</Adv>
                            <Adv k="Album">{row.original.album ?? "—"}</Adv>
                            <Adv k="Year / BPM">{(row.original.year ?? "—") + " / " + (row.original.bpm ?? "—")}</Adv>
                            <Adv k="Rating">{row.original.rating ?? "—"}</Adv>
                            <Adv k="ISRC">{row.original.isrc.join(", ") || "—"}</Adv>
                            <Adv k="Custom tags">{row.original.customTags ? JSON.stringify(row.original.customTags) : "—"}</Adv>
                            <Adv k="Comment frames">{row.original.comments.length ? row.original.comments.join("  |  ") : "—"}</Adv>
                            <Adv k="localRef">{row.localRef}</Adv>
                            <Adv k="metadataHash">{row.original.metadataHash?.slice(0, 16)}…</Adv>
                            <Adv k="Last read">{new Date(row.original.lastReadAt).toLocaleString()}</Adv>
                          </dl>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-[#4aa3ff] mb-1.5">✎ SyncBiz enrichment — editable (Postgres only)</div>
                          <div className="flex flex-col gap-2 max-w-[420px]">
                            <label className="text-[11px] text-[var(--sb-text-dim,#a8a8ae)]">My comment
                              <input defaultValue={row.enrichment?.myComment ?? ""} placeholder="add note…"
                                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (row.enrichment?.myComment ?? "")) patch(row, { myComment: v || null }); }}
                                className="mt-0.5 w-full text-[12px] px-2 py-1 rounded bg-black/30 border border-[var(--sb-border,#2a2a2e)] focus:border-[#0a84ff] outline-none" /></label>
                            {data?.customFields.map((cf) => (
                              <label key={cf.id} className="text-[11px] text-[var(--sb-text-dim,#a8a8ae)]">{cf.label}
                                {cf.type === "select" ? (
                                  <select value={String((row.enrichment?.customFields as Record<string, unknown>)?.[cf.name] ?? "")}
                                    onChange={(e) => patch(row, { customFields: { ...(row.enrichment?.customFields ?? {}), [cf.name]: e.target.value || undefined } })}
                                    className="mt-0.5 block text-[12px] px-1.5 py-1 rounded bg-black/30 border border-[var(--sb-border,#2a2a2e)]">
                                    <option value="">—</option>{cf.allowedOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                ) : (
                                  <input defaultValue={String((row.enrichment?.customFields as Record<string, unknown>)?.[cf.name] ?? "")}
                                    onBlur={(e) => patch(row, { customFields: { ...(row.enrichment?.customFields ?? {}), [cf.name]: e.target.value || undefined } })}
                                    className="mt-0.5 block w-full text-[12px] px-2 py-1 rounded bg-black/30 border border-[var(--sb-border,#2a2a2e)] focus:border-[#0a84ff] outline-none" />
                                )}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );})}
          </tbody>
        </table>
        {!loading && data && data.rows.length === 0 && <div className="p-8 text-center text-[13px] text-[var(--sb-text-dim,#8a8a90)]">No tracks match these filters.</div>}
        {loading && <div className="p-8 text-center text-[13px] text-[var(--sb-text-dim,#8a8a90)]">Loading…</div>}
      </div>

      <div className="px-5 py-2 border-t border-[var(--sb-border,#2a2a2e)] text-[11px] text-[var(--sb-text-dim,#8a8a90)] flex justify-between">
        <span>{data ? `${data.rows.length} shown · ${data.total} in slice` : ""}</span>
        <span>MP3 → SyncBiz (read-only). SyncBiz never writes to a music file.</span>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={`text-[12px] px-2.5 py-1.5 rounded-lg border ${active ? "bg-[#0a84ff] border-[#0a84ff] text-white" : "border-[var(--sb-border,#2a2a2e)] hover:bg-white/5"}`}>{children}</button>;
}
function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`py-2 pr-3 font-medium ${className}`}>{children}</th>;
}
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return <div><div className="text-[10px] text-[var(--sb-text-dim,#8a8a90)]">{label}</div><div className={`text-[15px] font-semibold ${accent ? "text-[#30d158]" : ""}`}>{value}</div></div>;
}
function Adv({ k, children }: { k: string; children: React.ReactNode }) {
  return <><dt className="text-[var(--sb-text-dim,#6a6a70)]">{k}</dt><dd className="truncate" title={typeof children === "string" ? children : undefined}>{children}</dd></>;
}
