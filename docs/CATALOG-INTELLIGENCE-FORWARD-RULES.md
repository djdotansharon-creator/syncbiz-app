# Catalog Intelligence — forward product rules (not yet implemented)

This document captures **product intent** for upcoming Catalog Tagging / Recommendation / Player Search work.  
**Stage 2** implemented only the **playlist `publicationScope` contract** (storage + edit API + UI).  
It does **not** change player search, playback, desktop, or catalog query behavior.

---

## Player search: SyncBiz Catalog–first (future)

When implemented in a dedicated stage:

1. **Default search behavior** in the player must be **SyncBiz Catalog–first**: query the internal SyncBiz catalog before external providers.
2. **Prefer**, in ranking or ordering: catalog items, official playlists (`publicationScope` includes official/template where applicable), published playlists, and workspace-accessible sources—exact ranking TBD with Catalog Tagging / Recommendation.
3. **Do not** default to external provider search for ordinary query text.
4. **External URL parsing** runs when the input is **clearly a URL**, or when the user **explicitly** chooses external search (explicit affordance).
5. This behavior belongs to the **Catalog Tagging / Recommendation / Player Search** milestone—not Stage 2.

### Protected UI note

Do not modify `components/library-input-area.tsx` (search + URL paste/drop unit) unless the user explicitly requests changes there—see workspace rule `library-search-url.mdc`.

---

## Stage 2 scope (implemented elsewhere in code)

- `PlaylistPublicationScope` + `Playlist.publicationScope` (default `PRIVATE`).
- `playlistOwnershipScope` (branch vs owner personal library) remains **separate** and unchanged in semantics.

---

## Related: Catalog Source Metadata (future stage)

External platform stats on each catalog identity (published date, views, likes, comments, fetch provenance) are specified in **`docs/CATALOG-SOURCE-METADATA-FUTURE.md`**. Deferred until after Stage 1/2 stabilization; **not** part of Stage 2.
