# SyncBiz search architecture

This document describes how library + external search is structured today, how it will stay **music-first** in the near term, and how the design stays **open for richer query modes later**—including **lyrics-snippet–style search**—without committing to heavy infrastructure in the current phase.

---

## Current phase (lightweight, deterministic)

- **Client:** `lib/search-service.ts` — internal substring match over library `UnifiedSource` data; external discovery via `GET /api/sources/search`.
- **Server:** `app/api/sources/search/route.ts` — YouTube (Data API / fallback packages / yt-dlp) + Radio Browser; optional query shaping via `lib/search-intent.ts`.
- **Quality:** A **music relevance** layer (scores / filters on titles, optional duration hints) is intended to run **after** provider results, **before** JSON—precision over recall, no ML requirement.

Constraints for this phase:

- No full lyrics database or lyric-provider integration.
- No change to playback runtime or access control from search alone.
- Deterministic heuristics first.

---

## Target query dimensions (product)

The search system should eventually support user intent along several axes—not only “text that matches a title”:

| Mode | User need | Example |
|------|-----------|--------|
| **Title** | Knows (part of) the track title | `"blue monday"` |
| **Artist** | Knows artist or project | `"Black Coffee"`, `"בניה ברבי"` |
| **Genre / vibe / context** | Mood, setting, style | `"afro house mix"`, `"restaurant jazz"`, `"morning gym"` |
| **Lyrics snippet** | Remembers a few words from chorus/verse; title/artist fuzzy or unknown | `"wake me up when september"`, mixed Hebrew/English fragments |

**Lyrics-snippet search** does *not* mean shipping a full lyrics product in v1. It means the **architecture must not paint us into a corner** so we can add lyric-aware retrieval later.

---

## Future: query intent detection

Introduce a stable, extensible notion of **search intent** (routing hint only), e.g.:

- `title` — default / explicit title-like queries.
- `artist` — artist- or act-first queries (possibly from patterns or light NER later).
- `genre_context` — mood, setting, genre, “for X” style (may overlap with `parseSearchIntent` today).
- `lyrics_snippet` — short phrase, likely lyric line, high token entropy vs. known catalog tokens, mixed scripts, etc.

**Intent** informs:

- Which providers to call (or in which order).
- How aggressively to apply music-vs-talk penalties.
- Whether to prefer **fuzzy / partial** matching over strict title match.

**Now:** intent can be a **single optional field** on an internal `ParsedSearchQuery` type (or similar) with a default of `unknown` / `title`—no behavior change required until strategies are wired.

---

## Future: lyrics-snippet and partial-text matching

When we implement lyrics-aware search, we will likely need **one or more** of:

1. **Indexed lyric-like text** — normalized lines (and optionally translations) stored or cached per track ID, with tokenization suitable for **partial** and **fuzzy** match (e.g. trigrams, prefix search, or dedicated text index).
2. **Provider APIs** — third-party lyric search APIs (if licensed and compliant); **provider-specific adapters** behind a small interface so YouTube/SoundCloud/Spotify specifics do not leak into UI.
3. **Fuzzy / spelling-tolerant matching** — especially for Hebrew/English mix and typos; may use edit distance, phonetic hints, or locale-aware normalization.
4. **Fallback ranking** — when confidence is low, return **fewer** high-quality hits (same policy as music-first filtering).

**Not in v1:** building or licensing a full lyrics corpus, running heavy embedding search, or blocking search on missing infrastructure.

---

## Design principles (extensibility)

1. **Keep provider results as a pipeline:** `fetch raw results → normalize shape → optional intent routing → relevance scoring → limit`.
2. **Keep a single “search result” shape** for UI (`title`, `url`, `cover`, optional `durationSeconds`, optional `musicScore` / `intent` later).
3. **Intent and scoring are additive**—new intents can add new steps without rewriting the whole route.
4. **Lyrics-specific logic** plugs in as **a strategy** (e.g. `LyricsSnippetSearchStrategy`) once data and legal/compliance are ready.

---

## Summary

| Topic | Today | Later |
|-------|--------|--------|
| Title / artist / genre-context | Heuristic query shaping + music relevance on titles | Richer `parseSearchIntent`, optional Music category on YouTube API, better internal ranking |
| Lyrics snippet | Not implemented | Intent `lyrics_snippet` + indexed partial text and/or provider adapters + fuzzy matching |
| Heavy AI / embeddings | Out of scope | Optional future tier |

This keeps the **current phase lightweight and deterministic** while documenting **what must be designed for** so lyrics-snippet search can land without a search-system rewrite.
