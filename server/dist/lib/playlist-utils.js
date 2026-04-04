"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmbeddedPlaylist = isEmbeddedPlaylist;
exports.canEmbedInCard = canEmbedInCard;
exports.getSpotifyId = getSpotifyId;
exports.getYouTubeVideoId = getYouTubeVideoId;
exports.getYouTubePlaylistId = getYouTubePlaylistId;
exports.isYouTubeMixUrl = isYouTubeMixUrl;
exports.getYouTubeSourceKind = getYouTubeSourceKind;
exports.isYouTubeMultiTrackUrl = isYouTubeMultiTrackUrl;
exports.getYouTubeThumbnail = getYouTubeThumbnail;
exports.isShazamUrl = isShazamUrl;
exports.extractShazamSongFromPath = extractShazamSongFromPath;
exports.inferPlaylistType = inferPlaylistType;
/** Map playlist type to embedded player support (opens in /player page). */
function isEmbeddedPlaylist(type) {
    return type === "youtube" || type === "soundcloud" || type === "stream-url";
}
/** Playlist types that can render embedded iframe in-card (YouTube, SoundCloud only). */
function canEmbedInCard(type) {
    return type === "youtube" || type === "soundcloud";
}
/** Get Spotify track/playlist ID from URL (for display). */
function getSpotifyId(url) {
    const m = url.match(/spotify\.com\/(?:track|playlist|album)\/([a-zA-Z0-9]+)/i);
    return m ? m[1] : null;
}
/** Get YouTube video ID from URL. */
function getYouTubeVideoId(url) {
    const u = url.trim();
    let m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?/]+)/i);
    if (m)
        return m[1];
    m = u.match(/youtube\.com\/shorts\/([^/?\s]+)/i);
    if (m)
        return m[1];
    m = u.match(/youtube\.com\/live\/([^/?\s]+)/i);
    return m ? m[1] : null;
}
/** Get YouTube playlist ID from URL (e.g. list=RDxxx, list=PLxxx). */
function getYouTubePlaylistId(url) {
    const u = url.trim();
    const m = u.match(/[?&]list=([^&\s]+)/i);
    return m ? m[1] : null;
}
/** True if URL is a YouTube Mix/Radio (list=RD...) – embed will auto-advance, do NOT call next() on ENDED. */
function isYouTubeMixUrl(url) {
    const listId = getYouTubePlaylistId(url);
    return !!listId && (listId.startsWith("RD") || url.includes("start_radio=1"));
}
/**
 * Classify a YouTube URL as single-track or multi-track.
 * Multi-track: playlist (list=PLxxx), radio (list=RDxxx), mix (start_radio=1), or similar.
 * Single: normal video URL without list/radio params.
 */
function getYouTubeSourceKind(url) {
    if (!url || typeof url !== "string")
        return "single";
    const u = url.trim().toLowerCase();
    if (!u.includes("youtube.com") && !u.includes("youtu.be"))
        return "single";
    if (u.includes("list="))
        return "multi";
    if (u.includes("start_radio=1"))
        return "multi";
    return "single";
}
/** True if URL is a YouTube multi-track source (playlist, radio, mix). */
function isYouTubeMultiTrackUrl(url) {
    return getYouTubeSourceKind(url) === "multi";
}
/** Build YouTube thumbnail URL. */
function getYouTubeThumbnail(url) {
    const vid = getYouTubeVideoId(url);
    return vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : null;
}
/** Check if URL is a Shazam song page. */
function isShazamUrl(url) {
    return /shazam\.com\/song\//i.test(url.trim());
}
/** Extract song name from Shazam URL path (e.g. /song/123/artist-song -> "artist song"). */
function extractShazamSongFromPath(url) {
    try {
        const u = new URL(url);
        const match = u.pathname.match(/\/song\/\d+\/([^/]+)/);
        if (!match)
            return null;
        const slug = decodeURIComponent(match[1]);
        return slug.replace(/-/g, " ").trim() || null;
    }
    catch {
        return null;
    }
}
/** Infer playlist type from URL or path. */
function inferPlaylistType(url) {
    const u = url.toLowerCase().trim();
    if (u.includes("youtube.com") || u.includes("youtu.be"))
        return "youtube";
    if (u.includes("soundcloud.com"))
        return "soundcloud";
    if (u.includes("spotify.com") || u.includes("open.spotify.com"))
        return "spotify";
    if (u.match(/\.(m3u8?|pls)(\?|$)/i))
        return "winamp";
    if (u.startsWith("http://") || u.startsWith("https://"))
        return "stream-url";
    return "local";
}
