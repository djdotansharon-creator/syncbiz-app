"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unifiedPlaylistSourceId = unifiedPlaylistSourceId;
exports.isEmbeddedPlaylist = isEmbeddedPlaylist;
exports.canEmbedInCard = canEmbedInCard;
exports.getSpotifyId = getSpotifyId;
exports.getYouTubeVideoId = getYouTubeVideoId;
exports.canonicalYouTubeWatchUrlForPlayback = canonicalYouTubeWatchUrlForPlayback;
exports.getYouTubePlaylistId = getYouTubePlaylistId;
exports.isYouTubeMixUrl = isYouTubeMixUrl;
exports.getYouTubeSourceKind = getYouTubeSourceKind;
exports.isYouTubeMultiTrackUrl = isYouTubeMultiTrackUrl;
exports.effectivePlaybackPlaylistAttachment = effectivePlaybackPlaylistAttachment;
exports.getYouTubeThumbnail = getYouTubeThumbnail;
exports.isShazamUrl = isShazamUrl;
exports.extractShazamSongFromPath = extractShazamSongFromPath;
exports.inferPlaylistType = inferPlaylistType;
/**
 * UnifiedSource / queue ids for playlists: stored `Playlist.id` is already `pl-*`.
 * Do not prefix again — `pl-${playlist.id}` would yield `pl-pl-...` and breaks lookups.
 */
function unifiedPlaylistSourceId(playlistId) {
    const id = (playlistId ?? "").trim();
    return id.startsWith("pl-") ? id : `pl-${id}`;
}
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
/**
 * Single-video watch URL for SyncBiz playback/embed — strips provider-native continuation
 * (list=, start_radio=, radio mixes, etc.). Import/resolve may still use full URLs; the player must not.
 */
function canonicalYouTubeWatchUrlForPlayback(url) {
    const vid = getYouTubeVideoId(url);
    if (!vid)
        return url;
    const u = url.trim().toLowerCase();
    if (!u.includes("youtube.com") && !u.includes("youtu.be"))
        return url;
    return `https://www.youtube.com/watch?v=${vid}`;
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
/**
 * For library `origin: "source"` rows, attached `playlist` metadata must not drive in-app
 * multi-track sessions (next/prev over tracks) when the URL is a playlist/list context —
 * that would nest unbounded playlist expansion inside another playlist/schedule.
 * Real playlist entities use `origin: "playlist"`.
 */
function effectivePlaybackPlaylistAttachment(source) {
    if (!source?.playlist)
        return null;
    if (source.origin === "playlist")
        return source.playlist;
    const url = source.url ?? "";
    if (String(source.type) === "playlist_url")
        return null;
    if (/youtube\.com\/playlist/i.test(url))
        return null;
    if (isYouTubeMultiTrackUrl(url))
        return null;
    return source.playlist;
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
