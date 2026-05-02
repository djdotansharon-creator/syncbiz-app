"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { MusicTaxonomyCategory } from "@prisma/client";
import {
  computeCatalogTagSuggestions,
  inferCatalogLanguageSignals,
  type CatalogTagSuggestion,
} from "@/lib/catalog-tagging-suggestions";

type TaxonomyTagRow = {
  id: string;
  slug: string;
  category: MusicTaxonomyCategory;
  labelEn: string;
  labelHe: string;
  status: string;
  aliases: string[];
};

type LinkRow = {
  id: string;
  taxonomyTagId: string;
  taxonomyTag: Pick<TaxonomyTagRow, "id" | "slug" | "category" | "labelEn" | "labelHe">;
};

/** Tab order matches Stage 5.5 UX brief — maps to MusicTaxonomyCategory. */
const CATEGORY_TABS: { id: MusicTaxonomyCategory | "ALL"; label: string }[] = [
  { id: "ALL", label: "All" },
  { id: "BUSINESS_FIT", label: "Business Fit" },
  { id: "MAIN_SOUND_GENRE", label: "Main Sound / Genre" },
  { id: "STYLE_TAGS", label: "Style Tags" },
  { id: "VIBE_ENERGY", label: "Vibe / Energy" },
  { id: "PLAYBACK_CONTEXT", label: "Playback Context" },
  { id: "ISRAELI_SPECIALS", label: "Israeli Specials" },
  { id: "TECHNICAL_TAGS", label: "Technical Tags" },
  { id: "DAYPART_FIT", label: "Daypart Fit" },
  { id: "CATALOG_PROGRAMMING", label: "Catalog Programming" },
];

function taxonomyCategoryLabel(cat: MusicTaxonomyCategory): string {
  const row = CATEGORY_TABS.find((t) => t.id === cat);
  return row?.label ?? cat.replace(/_/g, " ");
}

function dictionaryTagTooltip(t: TaxonomyTagRow): string {
  const lines: string[] = [t.labelEn, `Slug: ${t.slug}`, `Category: ${taxonomyCategoryLabel(t.category)}`];
  if (t.labelHe.trim()) lines.push(`Hebrew: ${t.labelHe}`);
  const aliases = t.aliases ?? [];
  if (aliases.length) lines.push(`Aliases: ${aliases.join(", ")}`);
  return lines.join("\n");
}

/** Subtle unlink — avoids heavy bordered “destructive button” chrome inside chips. */
function AssignedTagUnlinkIcon({
  title,
  onClick,
}: {
  title: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex shrink-0 rounded p-0.5 text-neutral-500 transition-colors hover:bg-neutral-800/90 hover:text-rose-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500/60"
      title={title}
      aria-label="Remove tag from this catalog item"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path
          d="M3 6h18M8 6V4h8v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function tagsMatchSearch(t: TaxonomyTagRow, q: string): boolean {
  const s = q.trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (t.slug.toLowerCase().includes(lower)) return true;
  if (t.labelEn.toLowerCase().includes(lower)) return true;
  if (t.labelHe.includes(s)) return true;
  return (t.aliases ?? []).some((a) => a.toLowerCase().includes(lower));
}

function normalizeTag(raw: TaxonomyTagRow): TaxonomyTagRow {
  return {
    ...raw,
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
  };
}

/**
 * SUPER_ADMIN-only: add/remove manual links between a global CatalogItem and ACTIVE dictionary tags.
 * Stage 5.5–5.8 — suggestions, review workflow, category tabs, batch POST (same API).
 */
export function CatalogItemTaxonomyEditor({
  catalogItemId,
  catalogTitle = "",
  catalogUrl = "",
  catalogProvider = null,
  playlistHintTexts = [],
  metadataHaystackParts = [],
  nextUntaggedHref = null,
  metadataSuggestions = [],
}: {
  catalogItemId: string | null;
  catalogTitle?: string;
  catalogUrl?: string;
  catalogProvider?: string | null;
  playlistHintTexts?: string[];
  /** Snapshot description, hashtags, channel title — strengthens deterministic hints only. */
  metadataHaystackParts?: string[];
  nextUntaggedHref?: string | null;
  /** Stage 5.9 — merged into deterministic suggestions (still pending → save only). */
  metadataSuggestions?: CatalogTagSuggestion[];
}) {
  const router = useRouter();
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [dictionary, setDictionary] = useState<TaxonomyTagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [categoryTab, setCategoryTab] = useState<MusicTaxonomyCategory | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [addingBatch, setAddingBatch] = useState(false);

  const hasLoadedOnceRef = useRef(false);
  const lastCatalogItemIdRef = useRef<string | null>(null);
  const preselectAppliedKeyRef = useRef<string>("");

  const base = catalogItemId
    ? `/api/admin/platform/catalog-items/${catalogItemId}/taxonomy-tags`
    : "";

  const load = useCallback(async () => {
    if (!catalogItemId || !base) {
      setLinks([]);
      setDictionary([]);
      setLoading(false);
      setErr(null);
      return;
    }
    setErr(null);
    const blockingSpinner = !hasLoadedOnceRef.current;
    if (blockingSpinner) setLoading(true);
    try {
      const fetchOpts: RequestInit = {
        credentials: "same-origin",
        cache: "no-store",
      };
      const [lr, dr] = await Promise.all([
        fetch(base, fetchOpts),
        fetch("/api/admin/platform/music-taxonomy/tags?status=ACTIVE", fetchOpts),
      ]);
      if (!lr.ok) {
        const j = await lr.json().catch(() => ({}));
        throw new Error(typeof j.error === "string" ? j.error : `Load links failed (${lr.status})`);
      }
      if (!dr.ok) {
        const j = await dr.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Load dictionary failed (${dr.status})`,
        );
      }
      const lj = (await lr.json()) as { links: LinkRow[] };
      const dj = (await dr.json()) as { tags: TaxonomyTagRow[] };
      setLinks(lj.links ?? []);
      const rawTags = (dj.tags ?? []).filter((t) => t.status === "ACTIVE").map(normalizeTag);
      const dedup = new Map<string, TaxonomyTagRow>();
      for (const t of rawTags) dedup.set(t.id, t);
      setDictionary([...dedup.values()]);
      hasLoadedOnceRef.current = true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [base, catalogItemId]);

  useEffect(() => {
    if (!catalogItemId) {
      setLoading(false);
      setLinks([]);
      setDictionary([]);
      setErr(null);
      setPendingIds(new Set());
      setSearchQuery("");
      setCategoryTab("ALL");
      preselectAppliedKeyRef.current = "";
      hasLoadedOnceRef.current = false;
      lastCatalogItemIdRef.current = null;
      return;
    }
    if (lastCatalogItemIdRef.current !== catalogItemId) {
      lastCatalogItemIdRef.current = catalogItemId;
      hasLoadedOnceRef.current = false;
      setLinks([]);
      setDictionary([]);
      setPendingIds(new Set());
      setSearchQuery("");
      setCategoryTab("ALL");
      preselectAppliedKeyRef.current = "";
    }
    void load();
  }, [catalogItemId, load]);

  const linkedIds = useMemo(() => {
    const s = new Set<string>();
    for (const l of links) {
      if (l.taxonomyTagId) s.add(l.taxonomyTagId);
      if (l.taxonomyTag?.id) s.add(l.taxonomyTag.id);
    }
    return s;
  }, [links]);

  /** Tags available to pick: ACTIVE, not yet assigned — assignment hides from picker. */
  const pickPool = useMemo(() => {
    return dictionary.filter((t) => !linkedIds.has(t.id));
  }, [dictionary, linkedIds]);

  const filteredPickList = useMemo(() => {
    let list = pickPool;
    if (categoryTab !== "ALL") {
      list = list.filter((t) => t.category === categoryTab);
    }
    list = list.filter((t) => tagsMatchSearch(t, searchQuery));
    return list.sort((a, b) =>
      a.category === b.category ? a.labelEn.localeCompare(b.labelEn) : a.category.localeCompare(b.category),
    );
  }, [pickPool, categoryTab, searchQuery]);

  const pendingResolved = useMemo(() => {
    const out: TaxonomyTagRow[] = [];
    for (const id of pendingIds) {
      const t = dictionary.find((x) => x.id === id);
      if (t) out.push(t);
    }
    out.sort((a, b) => a.labelEn.localeCompare(b.labelEn));
    return out;
  }, [pendingIds, dictionary]);

  const suggestions = useMemo(() => {
    if (!catalogItemId) return [];
    const hasHaystack =
      catalogTitle.trim().length > 0 ||
      catalogUrl.trim().length > 0 ||
      metadataHaystackParts.some((x) => typeof x === "string" && x.trim().length > 0);
    const base = hasHaystack
      ? computeCatalogTagSuggestions({
          dictionary: dictionary.map((t) => ({
            id: t.id,
            slug: t.slug,
            labelEn: t.labelEn,
            labelHe: t.labelHe,
            aliases: t.aliases ?? [],
          })),
          assignedIds: linkedIds,
          title: catalogTitle,
          url: catalogUrl,
          provider: catalogProvider,
          playlistHints: playlistHintTexts,
          extraHaystackParts: metadataHaystackParts,
        })
      : [];
    const seen = new Set(base.map((x) => x.taxonomyTagId));
    const merged: CatalogTagSuggestion[] = [...base];
    for (const m of metadataSuggestions) {
      if (linkedIds.has(m.taxonomyTagId) || seen.has(m.taxonomyTagId)) continue;
      seen.add(m.taxonomyTagId);
      merged.push(m);
    }
    return merged;
  }, [
    catalogItemId,
    catalogTitle,
    catalogUrl,
    catalogProvider,
    playlistHintTexts,
    metadataHaystackParts,
    dictionary,
    linkedIds,
    metadataSuggestions,
  ]);

  const languageSignals = useMemo(() => {
    const raw = [
      catalogTitle,
      catalogUrl,
      catalogProvider ?? "",
      ...playlistHintTexts,
      ...metadataHaystackParts,
    ].join(" ");
    return inferCatalogLanguageSignals(raw);
  }, [catalogTitle, catalogUrl, catalogProvider, playlistHintTexts, metadataHaystackParts]);

  const preselectKey = useMemo(
    () =>
      suggestions
        .filter((s) => s.preselectPending)
        .map((s) => s.taxonomyTagId)
        .sort()
        .join(","),
    [suggestions],
  );

  useEffect(() => {
    if (!catalogItemId || loading || dictionary.length === 0) return;
    const marker = `${catalogItemId}|${preselectKey}`;
    if (marker === preselectAppliedKeyRef.current) return;
    preselectAppliedKeyRef.current = marker;
    if (!preselectKey) return;
    const ids = suggestions.filter((s) => s.preselectPending).map((s) => s.taxonomyTagId);
    setPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (!linkedIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [catalogItemId, loading, dictionary.length, preselectKey, suggestions, linkedIds]);

  function togglePending(id: string) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removePending(id: string) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function clearPending() {
    setPendingIds(new Set());
  }

  function addAllSuggestedToPending() {
    setPendingIds((prev) => {
      const next = new Set(prev);
      for (const s of suggestions) {
        if (!linkedIds.has(s.taxonomyTagId)) next.add(s.taxonomyTagId);
      }
      return next;
    });
  }

  async function savePendingTags(): Promise<boolean> {
    if (!catalogItemId || !base) return false;
    if (pendingIds.size === 0) return true;
    setAddingBatch(true);
    setErr(null);
    const ids = [...pendingIds];
    try {
      for (const taxonomyTagId of ids) {
        const res = await fetch(base, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taxonomyTagId }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(typeof j.error === "string" ? j.error : `Add failed (${res.status})`);
        }
      }
      setPendingIds(new Set());
      await load();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Batch add failed");
      return false;
    } finally {
      setAddingBatch(false);
    }
  }

  async function saveAndNextUntagged() {
    if (!nextUntaggedHref) return;
    const ok = await savePendingTags();
    if (!ok) return;
    router.push(nextUntaggedHref);
  }

  function skipForNow() {
    if (!nextUntaggedHref) return;
    setPendingIds(new Set());
    setErr(null);
    router.push(nextUntaggedHref);
  }

  async function removeTag(taxonomyTagId: string) {
    const tagId = taxonomyTagId.trim();
    if (!tagId || !base) return;
    setErr(null);
    const url = `${base}/${encodeURIComponent(tagId)}`;
    const res = await fetch(url, { method: "DELETE", credentials: "same-origin", cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setErr(typeof j.error === "string" ? j.error : `Remove failed (${res.status})`);
      return;
    }
    await load();
  }

  if (!catalogItemId) {
    return (
      <div className="space-y-4 rounded-md border border-neutral-800 bg-neutral-950/60 p-4 opacity-90">
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-100/95">
          Select a catalog item first.
        </p>

        <div>
          <h3 className="text-sm font-medium text-neutral-500">Tags on this catalog item</h3>
          <p className="mt-2 text-sm text-neutral-600">Choose a row in the list below.</p>
        </div>

        <div className="rounded border border-neutral-800 bg-neutral-900/40 px-3 py-6 text-center text-xs text-neutral-600">
          Tag picker appears after selection.
        </div>
      </div>
    );
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading taxonomy tags…</p>;
  }

  return (
    <div className="space-y-4 rounded-md border border-neutral-800 bg-neutral-950/60 p-4">
      {err ? (
        <p className="rounded border border-rose-900/80 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {err}
        </p>
      ) : null}

      <div>
        <h3 className="text-sm font-medium text-neutral-200">Assigned tags ({links.length})</h3>
        <p className="mt-1 text-[11px] text-neutral-600">
          Removing unlinks this dictionary tag from this catalog row only — other assignments stay untouched.
        </p>
        {links.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No taxonomy tags yet.</p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {links.map((row) => (
              <li
                key={row.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-neutral-700 bg-neutral-900 py-1 pl-2.5 pr-1 text-xs text-neutral-200"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-neutral-100">{row.taxonomyTag.labelEn}</span>
                  <span className="block truncate font-mono text-[9px] text-neutral-500">{row.taxonomyTag.slug}</span>
                </span>
                <AssignedTagUnlinkIcon
                  title="Remove only this catalog item’s link to the tag (does not delete the tag from the dictionary)"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = (row.taxonomyTagId ?? row.taxonomyTag?.id ?? "").trim();
                    if (!id) {
                      setErr("Missing taxonomy tag id — reload the page.");
                      return;
                    }
                    void removeTag(id);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3 rounded-md border border-emerald-950/35 bg-emerald-950/10 px-3 py-3">
        <p className="text-[11px] leading-relaxed text-emerald-100/95">
          <span className="font-semibold text-emerald-50/95">Recommended:</span> 5–8 focused tags per catalog item.
        </p>
        {pendingIds.size > 10 ? (
          <p className="rounded border border-amber-800/60 bg-amber-950/35 px-2.5 py-2 text-[11px] text-amber-100">
            Too many tags may reduce recommendation quality.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={suggestions.length === 0}
            className="rounded border border-emerald-800/70 bg-emerald-950/50 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-900/60 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={addAllSuggestedToPending}
          >
            Add suggested tags
          </button>
          <button
            type="button"
            disabled={pendingIds.size === 0}
            className="rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={clearPending}
          >
            Clear pending
          </button>
          <Link
            href="/admin/platform/recommendation-coverage"
            className="inline-flex items-center rounded border border-neutral-600 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800"
          >
            Back to coverage
          </Link>
        </div>
      </div>

      <div className="rounded-md border border-violet-950/45 bg-violet-950/15 px-3 py-3">
        <h3 className="text-sm font-medium text-neutral-100">Suggested tags</h3>
        <p className="mt-1 text-[11px] text-neutral-500">
          Review only — suggestions are never auto-applied. High-confidence cues seed{" "}
          <strong className="font-medium text-neutral-400">pending</strong> until you save; weaker matches appear here for manual ticks only.
        </p>

        {languageSignals.length > 0 ? (
          <div className="mt-3 rounded border border-cyan-900/45 bg-cyan-950/20 px-2.5 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-200/90">
              Language / vocal hints (from title + URL + snapshot text)
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {languageSignals.map((sig) => (
                <li
                  key={sig.label}
                  className="rounded-full border border-cyan-800/40 bg-cyan-950/45 px-2 py-0.5 text-[11px] text-cyan-50"
                >
                  {sig.label}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {suggestions.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-600">No suggestions from current deterministic rules.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggestions.map((s) => {
              const inPending = pendingIds.has(s.taxonomyTagId);
              const tip = `${s.labelEn}\n${s.slug}\n\n${s.reason}`;
              return (
                <button
                  key={s.taxonomyTagId}
                  type="button"
                  title={tip}
                  className={`inline-flex max-w-[10.5rem] flex-col rounded-lg border px-2 py-1 text-left transition-colors ${
                    inPending
                      ? "border-violet-500/75 bg-violet-950/45 ring-1 ring-violet-500/25"
                      : "border-neutral-700 bg-neutral-950/55 hover:border-neutral-600 hover:bg-neutral-900/85"
                  }`}
                  onClick={() => togglePending(s.taxonomyTagId)}
                >
                  <span className="line-clamp-2 text-[11px] font-semibold leading-snug text-neutral-100">{s.labelEn}</span>
                  <span className="mt-0.5 truncate font-mono text-[9px] text-violet-300/90">{s.slug}</span>
                  {inPending ? (
                    <span className="mt-1 w-fit rounded bg-violet-900/65 px-1 py-px text-[8px] font-semibold uppercase text-violet-100">
                      Pending
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3 border-t border-neutral-800 pt-4">
        <h3 className="text-sm font-medium text-neutral-200">Add tags (search &amp; multi-select)</h3>
        <p className="text-[11px] text-neutral-600">
          Pick a category tab, search by slug, English, Hebrew, or alias, tick several tags, then add in one batch.
        </p>

        <div
          className="flex flex-wrap gap-1.5"
          role="tablist"
          aria-label="Taxonomy category filter"
        >
          {CATEGORY_TABS.map((tab) => {
            const active = categoryTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "border-sky-600 bg-sky-950/50 text-sky-100"
                    : "border-neutral-700 bg-neutral-900/80 text-neutral-400 hover:bg-neutral-800"
                }`}
                onClick={() => setCategoryTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <label className="flex flex-col gap-1 text-xs text-neutral-500">
          Search dictionary
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Slug, English, Hebrew, alias…"
            className="rounded border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 placeholder:text-neutral-600"
            autoComplete="off"
          />
        </label>

        {pendingResolved.length > 0 ? (
          <div className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber-200/90">
                Pending ({pendingResolved.length})
              </p>
              <button
                type="button"
                className="text-[11px] text-neutral-500 underline hover:text-neutral-300"
                onClick={clearPending}
              >
                Clear pending
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {pendingResolved.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex max-w-[14rem] items-start gap-1 rounded-lg border border-amber-800/55 bg-neutral-900/90 py-1 pl-2 pr-1 text-[11px] text-amber-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold leading-tight text-amber-50">{t.labelEn}</span>
                    <span className="block truncate font-mono text-[9px] text-neutral-500">{t.slug}</span>
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
                    aria-label={`Remove ${t.slug} from pending`}
                    onClick={() => removePending(t.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="max-h-[min(28rem,58vh)] overflow-y-auto rounded border border-neutral-800 bg-neutral-950/80 p-2">
          {filteredPickList.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-neutral-600">
              No matching tags — try another tab or search.
            </p>
          ) : (
            <ul
              className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(9.75rem,1fr))] gap-2 p-0 sm:grid-cols-[repeat(auto-fill,minmax(10.25rem,1fr))]"
              aria-label="Dictionary tags"
            >
              {filteredPickList.map((t) => {
                const pending = pendingIds.has(t.id);
                const catShort = taxonomyCategoryLabel(t.category);
                const tip = dictionaryTagTooltip(t);
                return (
                  <li key={t.id} className="min-w-0">
                    <button
                      type="button"
                      title={tip}
                      onClick={() => togglePending(t.id)}
                      className={`flex h-[5.125rem] w-full flex-col gap-1 rounded-lg border px-2 py-2 text-left transition-colors ${
                        pending
                          ? "border-sky-500/85 bg-sky-950/35 ring-1 ring-sky-500/35 shadow-sm shadow-black/20"
                          : "border-neutral-700 bg-neutral-900/85 hover:border-neutral-600 hover:bg-neutral-800/75"
                      }`}
                    >
                      <span className="min-h-0 flex-1 overflow-hidden text-[12px] font-semibold leading-snug text-neutral-100">
                        <span className="line-clamp-2 block">{t.labelEn}</span>
                      </span>
                      <span className="shrink-0 truncate font-mono text-[9px] text-neutral-500" title={t.slug}>
                        {t.slug}
                      </span>
                      <span
                        className="shrink-0 truncate text-[7px] font-medium uppercase tracking-wide text-neutral-600/90"
                        title={catShort}
                      >
                        {catShort}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-sky-900/50 bg-gradient-to-br from-sky-950/35 to-neutral-950/80 px-3 py-3 ring-1 ring-sky-800/40">
          <p className="text-[11px] leading-relaxed text-sky-100/95">
            <span className="font-semibold text-sky-50">Recommended workflow:</span> listen (audition tools), accept suggested tags,
            refine manually in the dictionary list above, then save or skip to the next untagged item.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pendingIds.size === 0 || addingBatch}
              className="rounded border border-sky-600 bg-sky-900/55 px-4 py-2 text-sm font-semibold text-sky-50 hover:bg-sky-800/70 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void savePendingTags()}
            >
              {addingBatch ? "Saving…" : "Save tags"}
            </button>
            <button
              type="button"
              disabled={addingBatch || !nextUntaggedHref}
              className="rounded border border-emerald-700 bg-emerald-950/45 px-4 py-2 text-sm font-semibold text-emerald-50 hover:bg-emerald-900/55 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void saveAndNextUntagged()}
              title={!nextUntaggedHref ? "No next untagged item in queue" : "Save pending tags (if any), then open the next untagged catalog row"}
            >
              Save &amp; next untagged
            </button>
          </div>
          <div className="mt-3">
            {nextUntaggedHref ? (
              <button
                type="button"
                className="w-full rounded-lg border-2 border-sky-500/80 bg-sky-950/40 px-4 py-3 text-center text-sm font-semibold tracking-wide text-sky-50 hover:bg-sky-900/55 sm:w-auto sm:min-w-[260px]"
                onClick={skipForNow}
              >
                Skip for now — next untagged
              </button>
            ) : (
              <p className="text-[11px] text-neutral-600">
                No further untagged items in this navigation queue (try widening filters or finish remaining rows).
              </p>
            )}
          </div>
          <details className="mt-3 rounded border border-neutral-700 bg-neutral-950/60 px-3 py-2 text-[11px] text-neutral-400">
            <summary className="cursor-pointer font-medium text-neutral-300 hover:text-neutral-200">
              Needs expert review
            </summary>
            <p className="mt-2 border-t border-neutral-800 pt-2 leading-relaxed text-neutral-500">
              There is no persisted review flag in V1 — nothing is stored when you expand this note. Track externally or wait for a future{" "}
              <code className="text-[10px] text-neutral-600">CatalogItem.reviewStatus</code>-style field before relying on in-app queues.
            </p>
          </details>
          <p className="mt-3 text-[10px] text-neutral-600">
            Save tags sends one POST per pending link (existing API). Filters and search params stay in the URL when you skip or save&amp;next.
          </p>
        </div>
      </div>

      <section className="rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2.5">
        <p className="text-[11px] font-medium text-neutral-400">Bulk tagging (planned — not implemented)</p>
        <p className="mt-1 text-[11px] leading-snug text-neutral-600">
          Later: multi-select catalog rows within filtered results, apply a shared tag set with confirmation and audit trail.
          Requires explicit approval before implementation.
        </p>
      </section>
    </div>
  );
}

/** Stage 5.7 — opens URLs in the browser only; never invokes SyncBiz playback / WS / desktop / MPV. */
export function CatalogAuditionBar({
  url,
  provider,
  videoId,
}: {
  url: string;
  provider: string | null;
  videoId?: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const youtubeHref = useMemo(() => youtubeAuditionHref(url, provider, videoId), [url, provider, videoId]);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded border border-emerald-800/70 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-900/50"
      >
        Open source URL
      </a>
      <button
        type="button"
        className="rounded border border-neutral-600 bg-neutral-800 px-2.5 py-1 text-[11px] font-medium text-neutral-200 hover:bg-neutral-700"
        onClick={() => void copyUrl()}
      >
        {copied ? "Copied" : "Copy URL"}
      </button>
      {youtubeHref ? (
        <a
          href={youtubeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-red-900/60 bg-red-950/35 px-2.5 py-1 text-[11px] font-medium text-red-100 hover:bg-red-950/55"
        >
          Open on YouTube
        </a>
      ) : null}
    </div>
  );
}

function youtubeAuditionHref(url: string, provider: string | null, videoId: string | null | undefined): string | null {
  const prov = (provider ?? "").toLowerCase();
  const looksYt = prov.includes("youtube") || /youtube\.com|youtu\.be/i.test(url);
  if (!looksYt) return null;
  if (videoId) {
    const vid = videoId.trim();
    if (vid.length >= 6 && /^[\w-]+$/.test(vid)) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}`;
    }
  }
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") || u.hostname.includes("youtu.be")) return url;
  } catch {
    return null;
  }
  return null;
}
