"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlaylistTracks = getPlaylistTracks;
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
