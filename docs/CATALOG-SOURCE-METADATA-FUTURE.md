# Catalog Source Metadata — future stage (not implemented)

**Status:** Deferred until **Stage 1 (workspace business profile)** and **Stage 2 (playlist publication scope)** are stabilized and merged.  
This is **catalog intelligence** only — **not** playlist visibility, **not** Business Profile, **not** internal play analytics (`CatalogAnalytics`).

---

## Product requirement

Every **`CatalogItem`** (and any future **`CatalogUrl`** / leaf identity row) should eventually persist **external platform metadata** on the canonical asset:

| Field | Meaning |
|--------|--------|
| `sourcePublishedAt` | When the video/track was published or uploaded on the external platform |
| `sourceViewCount` | Platform-reported views |
| `sourceLikeCount` | Platform-reported likes (where available) |
| `sourceCommentCount` | Platform-reported comments (where available) |
| `sourceStatsFetchedAt` | When SyncBiz last refreshed these stats |
| `sourceStatsProvider` | Origin of the snapshot (e.g. `youtube_api`, `yt_dlp`) |
| `sourceStatsUnavailableReason` | Optional text when stats cannot be fetched (quota, disabled likes, etc.) |

---

## YouTube ingestion (when implemented)

1. **Prefer YouTube Data API** when credentials/quota allow — map **`videos`** resources (e.g. **`snippet.publishedAt`**, **`statistics`** view/like/comment counts).
2. **Fallback** via **yt-dlp** **`--dump-json`** where fields exist (e.g. **`upload_date`**, **`view_count`**, **`like_count`**, **`comment_count`** — extractor-dependent).

Central resolver behavior today lives in **`lib/youtube-metadata-resolver.ts`** with **`lib/youtube-api-search.ts`** and **`lib/yt-dlp-search.ts`** — **do not extend until this stage is scheduled.**

---

## Explicit non-goals until implementation

- No **Prisma** schema fields or **migrations** for these columns yet.
- No changes to **`resolveYouTubeMetadata`** / ingest pipelines beyond normal maintenance unrelated to this doc.
- No **UI** surface yet (library cards, admin catalog, player).
- No coupling to **Persistent Player Shell**, **player search**, **desktop**, **WS**, **MPV**, or **Stage 3** tagging unless this stage is formally bundled with those milestones.

---

## Implementation note (later)

Prefer attaching stats to the **same deduped row** keyed by **`videoId` / canonical URL** (`CatalogItem` today) so **`Playlist`** / **`PlaylistItem`** convenience fields stay separate from catalog truth unless product merges them deliberately.
