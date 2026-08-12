"use client";

import { useCallback, useEffect, useState } from "react";
import { useAudioPreview } from "@/components/jingles-control/use-audio-preview";

/**
 * INTERNAL Voice Lab — SyncBiz team tool for choosing the voices customers will receive.
 * Lives under /admin (super-admin only), NOT in the customer Jingles player. Logic is unchanged
 * from the previous in-panel Voice Lab: it reuses the same catalog / shared-voices / benchmark
 * generate routes, the shared Browser-Preview hook (single-instance, no overlap) and the same
 * localStorage favorites key. OFF-PLAYBACK — nothing here touches the store player.
 */

type LabVoiceSource = "eleven-account" | "eleven-shared" | "google-chirp" | "gemini-official" | "house";
type LabVoice = {
  provider: "elevenlabs" | "google-chirp" | "google-gemini";
  model: string;
  voiceId: string;
  name: string;
  gender: "male" | "female" | "unknown";
  locale: string;
  previewUrl: string | null;
  supportsStyle: boolean;
  source: LabVoiceSource;
  house?: boolean;
};
type LabLocale = { code: string; label: string; enabled: boolean; state: "verified" | "beta" | "future" };

const SOURCE_TAG: Record<LabVoiceSource, string> = {
  "eleven-account": "acct",
  "eleven-shared": "lib",
  "google-chirp": "chirp",
  "gemini-official": "gemini",
  house: "house",
};

const pill = (active: boolean) =>
  `rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
    active ? "bg-sky-500/20 text-sky-200 ring-1 ring-sky-500/40" : "text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800/70"
  }`;

export default function VoiceLabAdmin() {
  const preview = useAudioPreview();

  // ── Catalog + filters ──
  const [labLocale, setLabLocale] = useState("he-IL");
  const [labLocales, setLabLocales] = useState<LabLocale[]>([]);
  const [labVoices, setLabVoices] = useState<LabVoice[]>([]);
  const [labLoading, setLabLoading] = useState(false);
  const [labError, setLabError] = useState<string | null>(null);
  const [labSpoken, setLabSpoken] = useState("");
  const [labStyle, setLabStyle] = useState<"Neutral" | "Sales" | "Energetic" | "Premium" | "Urgent">("Neutral");
  const [labProvider, setLabProvider] = useState<"all" | LabVoice["provider"]>("all");
  const [labGender, setLabGender] = useState<"all" | "male" | "female">("all");
  const [labSearch, setLabSearch] = useState("");
  const [labFavOnly, setLabFavOnly] = useState(false);
  const [labFavorites, setLabFavorites] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(JSON.parse(localStorage.getItem("syncbiz.voicelab.favorites") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const [labResults, setLabResults] = useState<Record<string, { loading?: boolean; url?: string; error?: string }>>({});

  const labKey = useCallback((v: LabVoice) => `${v.source}:${v.voiceId}`, []);

  const loadCatalog = useCallback(async (locale: string) => {
    setLabLoading(true);
    setLabError(null);
    try {
      const res = await fetch(`/api/jingles/voice-catalog?locale=${encodeURIComponent(locale)}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `catalog ${res.status}`);
      setLabVoices(j.voices ?? []);
      if (j.locales) setLabLocales(j.locales);
    } catch (e) {
      setLabError(e instanceof Error ? e.message : String(e));
      setLabVoices([]);
    } finally {
      setLabLoading(false);
    }
  }, []);

  // ── Shared library (paginated) ──
  const [sharedVoices, setSharedVoices] = useState<LabVoice[]>([]);
  const [sharedPage, setSharedPage] = useState(0);
  const [sharedHasMore, setSharedHasMore] = useState(false);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [sharedSearch, setSharedSearch] = useState("");
  const [sharedOpen, setSharedOpen] = useState(false);

  const loadShared = useCallback(
    async (locale: string, page: number, opts?: { gender?: string; search?: string }) => {
      setSharedLoading(true);
      setSharedError(null);
      try {
        const params = new URLSearchParams({ locale, page: String(page) });
        if (opts?.gender && opts.gender !== "all") params.set("gender", opts.gender);
        if (opts?.search?.trim()) params.set("search", opts.search.trim());
        const res = await fetch(`/api/jingles/shared-voices?${params.toString()}`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `shared ${res.status}`);
        setSharedVoices((prev) => (page === 0 ? j.voices ?? [] : [...prev, ...(j.voices ?? [])]));
        setSharedHasMore(!!j.hasMore);
        setSharedPage(page);
      } catch (e) {
        setSharedError(e instanceof Error ? e.message : String(e));
      } finally {
        setSharedLoading(false);
      }
    },
    []
  );

  // Load base catalog on mount + locale change; reset shared (locale-specific).
  useEffect(() => {
    void loadCatalog(labLocale);
    setSharedVoices([]);
    setSharedPage(0);
    setSharedHasMore(false);
    setSharedOpen(false);
  }, [labLocale, loadCatalog]);

  const toggleFavorite = useCallback((key: string) => {
    setLabFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem("syncbiz.voicelab.favorites", JSON.stringify([...next]));
      } catch {
        /* ignore quota */
      }
      return next;
    });
  }, []);

  const generateLabVoice = useCallback(
    async (v: LabVoice) => {
      const text = labSpoken.trim();
      if (!text) return;
      const key = `${v.source}:${v.voiceId}`;
      setLabResults((r) => ({ ...r, [key]: { loading: true } }));
      try {
        const res = await fetch("/api/jingles/benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: v.provider,
            voiceId: v.voiceId,
            text,
            locale: v.locale === "*" ? labLocale : v.locale,
            style: v.supportsStyle ? labStyle : undefined,
          }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `generate ${res.status}`);
        setLabResults((r) => ({ ...r, [key]: { url: j.url } }));
      } catch (e) {
        setLabResults((r) => ({ ...r, [key]: { error: e instanceof Error ? e.message : String(e) } }));
      }
    },
    [labSpoken, labStyle, labLocale]
  );

  const filteredLabVoices = labVoices.filter((v) => {
    if (labProvider !== "all" && v.provider !== labProvider) return false;
    if (labGender !== "all" && v.gender !== labGender) return false;
    if (labFavOnly && !labFavorites.has(labKey(v))) return false;
    if (labSearch.trim()) {
      const q = labSearch.trim().toLowerCase();
      if (!v.name.toLowerCase().includes(q) && !v.voiceId.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Hebrew Benchmark (internal A/B/C, same spoken text) ──
  const [benchOriginal, setBenchOriginal] = useState("");
  const [benchSpoken, setBenchSpoken] = useState("");
  const [benchGender, setBenchGender] = useState<"male" | "female">("male");
  const [benchStyle, setBenchStyle] = useState<"Neutral" | "Energetic" | "Premium" | "Urgent">("Neutral");
  const [benchResults, setBenchResults] = useState<
    Record<"A" | "B" | "C", { loading?: boolean; url?: string; label?: string; error?: string }>
  >({ A: {}, B: {}, C: {} });
  const [benchOpen, setBenchOpen] = useState(false);

  const runBenchmark = useCallback(
    async (candidate: "A" | "B" | "C") => {
      const text = benchSpoken.trim();
      if (!text) return;
      setBenchResults((r) => ({ ...r, [candidate]: { loading: true } }));
      try {
        const res = await fetch("/api/jingles/benchmark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidate, text, gender: benchGender, style: benchStyle }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        setBenchResults((r) => ({ ...r, [candidate]: { url: j.url, label: `${j.provider} · ${j.model} · ${j.voice}` } }));
      } catch (e) {
        setBenchResults((r) => ({ ...r, [candidate]: { error: e instanceof Error ? e.message : String(e) } }));
      }
    },
    [benchSpoken, benchGender, benchStyle]
  );

  // ── Flat voice row (reused for base + shared) ──
  const voiceRow = (v: LabVoice) => {
    const key = labKey(v);
    const r = labResults[key] ?? {};
    const playingGen = !!r.url && preview.previewUrl === r.url;
    const playingNative = !!v.previewUrl && preview.previewUrl === v.previewUrl;
    const fav = labFavorites.has(key);
    return (
      <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-neutral-800/70 py-2">
        <button
          type="button"
          onClick={() => toggleFavorite(key)}
          title={fav ? "Remove from shortlist" : "Add to shortlist"}
          className={`text-base leading-none ${fav ? "text-amber-400" : "text-neutral-600 hover:text-neutral-400"}`}
        >
          {fav ? "★" : "☆"}
        </button>
        <span className="min-w-[130px] text-[13px] font-medium text-neutral-100">
          {v.house ? "👑 " : ""}
          {v.name}
        </span>
        <span className="rounded border border-neutral-700 px-1.5 py-px text-[10px] uppercase tracking-wide text-neutral-500">
          {SOURCE_TAG[v.source]}
        </span>
        <span className="min-w-[150px] text-[11px] text-neutral-500">
          {v.provider === "elevenlabs" ? "ElevenLabs" : "Google"} · {v.model}
          {v.gender !== "unknown" ? ` · ${v.gender}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {v.previewUrl ? (
            <button
              type="button"
              className="rounded border border-neutral-700 px-2 py-1 text-[12px] text-neutral-200 hover:bg-neutral-800"
              onClick={() => v.previewUrl && preview.toggle(v.previewUrl)}
            >
              {playingNative ? "■ Stop" : "♪ Native"}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded border border-neutral-700 px-2 py-1 text-[12px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
            disabled={!labSpoken.trim() || r.loading}
            onClick={() => void generateLabVoice(v)}
          >
            {r.loading ? "Generating…" : "Generate"}
          </button>
          <button
            type="button"
            className="rounded bg-sky-500/90 px-2 py-1 text-[12px] font-medium text-white hover:bg-sky-500 disabled:opacity-40"
            disabled={!r.url}
            onClick={() => r.url && preview.toggle(r.url)}
          >
            {playingGen ? "■ Stop" : "▶ Preview"}
          </button>
        </div>
        {r.error ? <span className="w-full text-[11px] text-rose-400">{r.error.slice(0, 120)}</span> : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Voice Lab</h1>
        <p className="text-xs text-neutral-500">
          Internal tool — choose the voices customers receive. Reuses the live catalog + generate routes. Not part of the player.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-neutral-800 pb-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Lang</span>
          {(labLocales.length ? labLocales : [{ code: "he-IL", label: "Hebrew", enabled: true, state: "verified" as const }]).map((l) => {
            const badge = l.state === "verified" ? { t: "Verified", c: "text-emerald-400" } : l.state === "beta" ? { t: "Beta", c: "text-amber-400" } : { t: "Future", c: "text-neutral-500" };
            return (
              <button key={l.code} type="button" className={pill(labLocale === l.code)} onClick={() => setLabLocale(l.code)} title={`${l.label} — ${badge.t}`}>
                {l.label}
                <span className={`ml-1 text-[9px] uppercase ${badge.c}`}>{badge.t}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Provider</span>
          {(["all", "elevenlabs", "google-chirp", "google-gemini"] as const).map((p) => (
            <button key={p} type="button" className={pill(labProvider === p)} onClick={() => setLabProvider(p)}>
              {p === "all" ? "All" : p === "elevenlabs" ? "Eleven" : p === "google-chirp" ? "Chirp" : "Gemini"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Gender</span>
          {(["all", "male", "female"] as const).map((g) => (
            <button key={g} type="button" className={pill(labGender === g)} onClick={() => setLabGender(g)}>
              {g === "all" ? "All" : g === "male" ? "Male" : "Female"}
            </button>
          ))}
        </div>
        <button type="button" className={pill(labFavOnly)} onClick={() => setLabFavOnly((x) => !x)}>
          ★ Favorites
        </button>
        <input
          value={labSearch}
          onChange={(e) => setLabSearch(e.target.value)}
          placeholder="Search voice…"
          className="min-w-[140px] flex-1 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[13px] text-neutral-100 placeholder:text-neutral-600"
        />
      </div>

      {/* Spoken text */}
      <textarea
        rows={2}
        dir="auto"
        value={labSpoken}
        onChange={(e) => setLabSpoken(e.target.value)}
        placeholder="Spoken / vocalized text — sent identically to every voice you Generate"
        className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-600"
      />

      <div className="flex items-center gap-1">
        <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Gemini delivery</span>
        {(["Neutral", "Sales", "Energetic", "Premium", "Urgent"] as const).map((s) => (
          <button key={s} type="button" className={pill(labStyle === s)} onClick={() => setLabStyle(s)}>
            {s}
          </button>
        ))}
      </div>

      {labError ? <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{labError}</div> : null}
      <div className="text-[12px] text-neutral-500">{labLoading ? "Loading catalog…" : `${filteredLabVoices.length} voice${filteredLabVoices.length === 1 ? "" : "s"}`}</div>

      {/* Base voice list */}
      <div className="border-t border-neutral-800/70">
        {filteredLabVoices.map(voiceRow)}
        {!labLoading && filteredLabVoices.length === 0 ? (
          <div className="py-3 text-[12px] text-neutral-600">No voices match. Try another provider/locale or clear filters.</div>
        ) : null}
      </div>

      {/* Shared library */}
      <div className="mt-2 border-t border-neutral-800 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-neutral-200">
            ElevenLabs shared library <span className="font-normal text-neutral-500">· community · loaded on demand</span>
          </span>
          {!sharedOpen ? (
            <button
              type="button"
              className="rounded border border-neutral-700 px-2 py-1 text-[12px] text-neutral-200 hover:bg-neutral-800"
              onClick={() => {
                setSharedOpen(true);
                void loadShared(labLocale, 0, { gender: labGender, search: sharedSearch });
              }}
            >
              Load library
            </button>
          ) : null}
        </div>

        {sharedOpen ? (
          <>
            <div className="my-2 flex flex-wrap items-center gap-2">
              <input
                value={sharedSearch}
                onChange={(e) => setSharedSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void loadShared(labLocale, 0, { gender: labGender, search: sharedSearch });
                }}
                placeholder="Search shared library…"
                className="min-w-[160px] flex-1 rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-[13px] text-neutral-100 placeholder:text-neutral-600"
              />
              <button
                type="button"
                className="rounded bg-sky-500/90 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-sky-500"
                onClick={() => void loadShared(labLocale, 0, { gender: labGender, search: sharedSearch })}
              >
                Search
              </button>
              <span className="text-[11px] text-neutral-500">
                lang {labLocale.split("-")[0]}
                {labGender !== "all" ? ` · ${labGender}` : ""}
              </span>
            </div>

            {sharedError ? <div className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-300">{sharedError}</div> : null}

            <div className="border-t border-neutral-800/70">
              {sharedVoices.map(voiceRow)}
              {!sharedLoading && sharedVoices.length === 0 && !sharedError ? (
                <div className="py-3 text-[12px] text-neutral-600">No shared voices for this language/filter.</div>
              ) : null}
            </div>

            <div className="mt-2 flex justify-center">
              {sharedLoading ? (
                <span className="text-[12px] text-neutral-500">Loading…</span>
              ) : sharedHasMore ? (
                <button
                  type="button"
                  className="rounded border border-neutral-700 px-3 py-1 text-[12px] text-neutral-200 hover:bg-neutral-800"
                  onClick={() => void loadShared(labLocale, sharedPage + 1, { gender: labGender, search: sharedSearch })}
                >
                  Load more
                </button>
              ) : sharedVoices.length > 0 ? (
                <span className="text-[11px] text-neutral-600">End of results</span>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {/* Hebrew Benchmark (internal A/B/C) */}
      <div className="mt-2 border-t border-neutral-800 pt-3">
        <button type="button" className="text-[13px] font-medium text-neutral-200 hover:text-white" onClick={() => setBenchOpen((x) => !x)}>
          {benchOpen ? "▾" : "▸"} Hebrew Voice Benchmark <span className="font-normal text-neutral-500">· A/B/C · same spoken text</span>
        </button>
        {benchOpen ? (
          <div className="mt-2 space-y-2">
            <textarea
              rows={2}
              dir="auto"
              value={benchOriginal}
              onChange={(e) => setBenchOriginal(e.target.value)}
              placeholder="Original text (reference only — not sent)"
              className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-600"
            />
            <textarea
              rows={2}
              dir="auto"
              value={benchSpoken}
              onChange={(e) => setBenchSpoken(e.target.value)}
              placeholder="Spoken text — sent identically to A/B/C (paste niqqud-vocalized here)"
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-[13px] text-neutral-100 placeholder:text-neutral-600"
            />
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Voice</span>
                {(["male", "female"] as const).map((g) => (
                  <button key={g} type="button" className={pill(benchGender === g)} onClick={() => setBenchGender(g)}>
                    {g === "male" ? "Male" : "Female"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-[11px] uppercase tracking-wide text-neutral-500">Gemini style</span>
                {(["Neutral", "Energetic", "Premium", "Urgent"] as const).map((s) => (
                  <button key={s} type="button" className={pill(benchStyle === s)} onClick={() => setBenchStyle(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            {([["A", "A · Eleven v3"], ["B", "B · Google Chirp"], ["C", "C · Gemini TTS"]] as const).map(([cand, title]) => {
              const r = benchResults[cand];
              const playing = !!r.url && preview.previewUrl === r.url;
              return (
                <div key={cand} className="flex items-center gap-2 border-t border-neutral-800/70 py-1.5">
                  <span className="min-w-[130px] text-[13px] font-medium text-neutral-100">{title}</span>
                  <button
                    type="button"
                    className="rounded border border-neutral-700 px-2 py-1 text-[12px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-40"
                    disabled={!benchSpoken.trim() || r.loading}
                    onClick={() => void runBenchmark(cand)}
                  >
                    {r.loading ? "Generating…" : "Generate"}
                  </button>
                  <button
                    type="button"
                    className="rounded bg-sky-500/90 px-2 py-1 text-[12px] font-medium text-white hover:bg-sky-500 disabled:opacity-40"
                    disabled={!r.url}
                    onClick={() => r.url && preview.toggle(r.url)}
                  >
                    {playing ? "■ Stop" : "▶ Preview"}
                  </button>
                  <span className="text-[11px] text-neutral-500">
                    {r.error ? <span className="text-rose-400">{r.error.slice(0, 100)}</span> : r.label || ""}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {preview.error ? <div className="text-[12px] text-rose-400">{preview.error}</div> : null}
    </div>
  );
}
