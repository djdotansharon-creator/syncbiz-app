You are the lead architect of SYNCBIZ.

We need to implement the CatalogItem data pipeline properly.

CONTEXT:
- We already have yt-dlp installed and working on Railway
- CatalogItem is our global shared URL catalog
- Prisma Studio is owner-only admin panel (local only)
- backfill-genres returned {updated: 0} — needs investigation

TASK 1 — Fix duplicate URL detection:
Add to CatalogItem schema:
- canonicalUrl (unique) — normalized YouTube URL
- videoId — extracted YouTube video ID  
- provider — "youtube" | "soundcloud" | "direct"

When saving any URL:
1. Extract videoId from URL (handle all YouTube URL formats)
2. Check if videoId already exists in DB
3. If exists → update missing fields only, never overwrite manual edits
4. If not exists → create new with auto-fill

TASK 2 — Auto-fill using existing yt-dlp:
When a new CatalogItem is created, automatically fill:
- title (from yt-dlp metadata)
- thumbnail
- durationSec
- canonicalUrl
- videoId
- provider

Only fill if field is currently empty.
Be conservative with: artist, genres, businessTypes.

TASK 3 — Fix backfill-genres returning {updated: 0}:
Investigate why the backfill-genres endpoint returned 0.
The CatalogItem table has 313 items, most with empty genres.
Fix the genre detection logic to work with existing items.
Use YouTube title parsing to detect genre keywords.

TASK 4 — Wire player Edit to DB:
When user edits a CatalogItem in the player UI and saves:
- Send to API route PUT /api/catalog/[id]
- Only update fields that changed
- Return minimal response: { ok, action, autoFilled }

Do ONE task at a time. Start with TASK 1.
Show schema changes before writing any code.