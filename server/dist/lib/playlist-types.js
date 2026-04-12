"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT = exports.PLAYLIST_ENERGY_LEVELS_PHASE15 = exports.PLAYLIST_MOODS_PHASE15 = exports.PLAYLIST_SUB_GENRES_PHASE15 = exports.PLAYLIST_PRIMARY_GENRES_PHASE15 = exports.PLAYLIST_USE_CASES_PHASE1 = void 0;
exports.effectivePlaylistUseCases = effectivePlaylistUseCases;
exports.getPlaylistTracks = getPlaylistTracks;
const playlist_metadata_registry_1 = require("./playlist-metadata-registry");
exports.PLAYLIST_USE_CASES_PHASE1 = playlist_metadata_registry_1.playlistMetadataRegistry.useCases.map((o) => o.value);
exports.PLAYLIST_PRIMARY_GENRES_PHASE15 = playlist_metadata_registry_1.playlistMetadataRegistry.primaryGenres.map((o) => o.value);
exports.PLAYLIST_SUB_GENRES_PHASE15 = playlist_metadata_registry_1.playlistMetadataRegistry.subGenres.map((o) => o.value);
exports.PLAYLIST_MOODS_PHASE15 = playlist_metadata_registry_1.playlistMetadataRegistry.moods.map((o) => o.value);
exports.PLAYLIST_ENERGY_LEVELS_PHASE15 = playlist_metadata_registry_1.playlistMetadataRegistry.energyLevels.map((o) => o.value);
/**
 * POST /api/playlists body only — not stored on `Playlist`. When present, the server sets
 * `libraryPlacement: "ready_external"` (Ready Playlists). Only the YouTube Mix Import save
 * flow should send this.
 */
exports.PLAYLIST_CREATE_SAVE_ORIGIN_YOUTUBE_MIX_IMPORT = "youtube_mix_import";
/** Effective use cases: prefer `useCases` when non-empty; else legacy single `useCase`. */
function effectivePlaylistUseCases(p) {
    if (p.useCases && p.useCases.length > 0)
        return [...p.useCases];
    if (p.useCase)
        return [p.useCase];
    return [];
}
/** Get effective tracks for a playlist (tracks array or legacy single URL). */
function getPlaylistTracks(p) {
    if (p.tracks && p.tracks.length > 0) {
        const order = p.order ?? p.tracks.map((t) => t.id);
        return order
            .map((id) => p.tracks.find((t) => t.id === id))
            .filter((t) => !!t)
            .map((t) => ({
            ...t,
            name: t.name || t.title || "Untitled",
        }));
    }
    return [
        {
            id: p.id,
            name: p.name,
            type: p.type,
            url: p.url,
            cover: p.thumbnail || undefined,
        },
    ];
}
