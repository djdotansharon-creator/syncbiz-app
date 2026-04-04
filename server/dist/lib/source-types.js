"use strict";
/**
 * Unified Source type for the Sources library view.
 * Normalizes Playlist and db Source into a single display format.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseUrlFoundationHints = parseUrlFoundationHints;
exports.unifiedFoundationHints = unifiedFoundationHints;
exports.pickUnifiedFoundationFields = pickUnifiedFoundationFields;
exports.classifyLibraryEntityContract = classifyLibraryEntityContract;
const url_resolve_classify_1 = require("./url-resolve-classify");
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
    if (source.origin === "playlist") {
        return { entityKind: "collection", collectionSubtype: "syncbiz_playlist" };
    }
    return { entityKind: "item", itemSubtype: "single_track" };
}
