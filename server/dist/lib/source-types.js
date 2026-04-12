"use strict";
/**
 * Unified Source type for the Sources library view.
 * Normalizes Playlist and db Source into a single display format.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIBRARY_CARD_FALLBACK_GENRE = void 0;
exports.unifiedLibraryIdForDbSourceId = unifiedLibraryIdForDbSourceId;
exports.libraryCardDisplayGenre = libraryCardDisplayGenre;
exports.libraryCardEffectiveViewCount = libraryCardEffectiveViewCount;
exports.libraryCardShouldShowMetaRow = libraryCardShouldShowMetaRow;
exports.parseUrlFoundationHints = parseUrlFoundationHints;
exports.unifiedFoundationHints = unifiedFoundationHints;
exports.pickUnifiedFoundationFields = pickUnifiedFoundationFields;
exports.classifyLibraryEntityContract = classifyLibraryEntityContract;
const url_resolve_classify_1 = require("./url-resolve-classify");
/**
 * Unified list / playback id for a DB `Source` row. Store-generated ids are already `src-*`;
 * prefixing again yields `src-src-*` and breaks GET `/api/sources/[id]` and `?sourceId=` flows.
 */
function unifiedLibraryIdForDbSourceId(dbSourceId) {
    return dbSourceId.startsWith("src-") ? dbSourceId : `src-${dbSourceId}`;
}
/** Genre line when persisted value is empty — never use `type` (provider slug) as genre. */
exports.LIBRARY_CARD_FALLBACK_GENRE = "Mixed";
function libraryCardDisplayGenre(source) {
    const g = typeof source.genre === "string" ? source.genre.trim() : "";
    return g || exports.LIBRARY_CARD_FALLBACK_GENRE;
}
function libraryCardEffectiveViewCount(source) {
    const v = source.viewCount ?? source.playlist?.viewCount;
    if (v == null || typeof v !== "number" || !Number.isFinite(v))
        return undefined;
    return v;
}
/**
 * Library card footer meta row: show when there is a real genre, view count, or duration-in-meta rule.
 * When shown, `libraryCardDisplayGenre` supplies the left label (fallback "Mixed"), not `source.type`.
 */
function libraryCardShouldShowMetaRow(source, durationSec, hasCoverArt) {
    const hasPersistedGenre = Boolean(typeof source.genre === "string" && source.genre.trim());
    const vc = libraryCardEffectiveViewCount(source);
    const showDurationInMeta = durationSec > 0 && !hasCoverArt;
    return hasPersistedGenre || vc != null || showDurationInMeta;
}
/**
 * Deterministic hints for URL ingest (matches server parse-url; no I/O).
 * Delegates to `classifyResolveFoundation` — keep client and API aligned.
 */
function parseUrlFoundationHints(params) {
    return (0, url_resolve_classify_1.classifyResolveFoundation)(params);
}
/** Foundation hints for unified list rows by origin (library API). */
function unifiedFoundationHints(origin, type, url) {
    const isRadio = origin === "radio";
    const inferred = type;
    return parseUrlFoundationHints({
        rawUrl: url,
        inferredType: inferred,
        isRadio,
        isShazam: false,
    });
}
/** Pick only foundation keys from a parse-url response or similar object. */
function pickUnifiedFoundationFields(p) {
    if (!p)
        return {};
    const keys = [
        "contentNodeKind",
        "mediaKind",
        "executionTarget",
        "engineSelectionPolicy",
        "mixStrategyHint",
        "taxonomyTags",
        "executionAdapterId",
        "preferredEngineType",
    ];
    const out = {};
    for (const k of keys) {
        if (k in p && p[k] !== undefined) {
            out[k] = p[k];
        }
    }
    return out;
}
/**
 * Classify UnifiedSource into the locked Library model:
 * collections/containers vs media items.
 */
function classifyLibraryEntityContract(source) {
    const kind = source.contentNodeKind;
    if (kind === "syncbiz_playlist") {
        return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
    }
    if (kind === "external_playlist") {
        return { entityKind: "collection", collectionSubtype: "external_playlist" };
    }
    if (kind === "mix_set") {
        return { entityKind: "item", itemSubtype: "mix_set" };
    }
    if (kind === "radio_stream" || source.origin === "radio") {
        return { entityKind: "item", itemSubtype: "radio_stream" };
    }
    if (kind === "ai_asset") {
        return { entityKind: "item", itemSubtype: "ai_asset" };
    }
    if (kind === "single_track" || kind === "track") {
        return { entityKind: "item", itemSubtype: "single_track" };
    }
    // Stable fallback rules for legacy rows.
    const u = (source.url ?? "").toLowerCase();
    const isExternalPlaylist = (u.includes("youtube.com") && u.includes("list=")) ||
        (u.includes("open.spotify.com") && (u.includes("/playlist/") || u.includes("/album/"))) ||
        (u.includes("soundcloud.com") && u.includes("/sets/"));
    if (isExternalPlaylist) {
        return { entityKind: "collection", collectionSubtype: "external_playlist" };
    }
    if (source.origin === "playlist" && source.playlist?.libraryPlacement === "ready_external") {
        return { entityKind: "collection", collectionSubtype: "external_playlist" };
    }
    if (source.origin === "playlist") {
        return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
    }
    return { entityKind: "item", itemSubtype: "single_track" };
}
