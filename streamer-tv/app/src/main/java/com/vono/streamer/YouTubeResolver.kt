package com.vono.streamer

import android.util.Log
import okhttp3.OkHttpClient
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.stream.DeliveryMethod
import org.schabi.newpipe.extractor.stream.StreamInfo

/**
 * On-device YouTube resolution via NewPipeExtractor. Turns a YouTube videoId → a direct
 * progressive audio stream URL (+ title/artwork/duration), and a playlist/mix URL → an ordered
 * list of videoIds. Runs on the DEVICE, so the resolved googlevideo URL is signed to the GOtv's
 * own IP (no cross-IP 403). Blocking network work — call OFF the main thread.
 */
object YouTubeResolver {
    private const val TAG = "VonoStreamer"

    @Volatile private var inited = false

    fun ensureInit(client: OkHttpClient) {
        if (inited) return
        synchronized(this) {
            if (!inited) {
                NewPipe.init(NewPipeOkHttpDownloader(client))
                inited = true
            }
        }
    }

    data class Resolved(val audioUrl: String, val title: String, val artwork: String?, val durationSec: Long)
    data class YtItem(val videoId: String, val title: String, val artwork: String?, val durationSec: Long = 0)

    /** videoId → playable progressive audio URL (highest bitrate). Null if resolution failed. */
    fun resolveAudio(videoId: String): Resolved? {
        return try {
            val info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")
            val progressive = info.audioStreams.orEmpty().filter {
                it.deliveryMethod == DeliveryMethod.PROGRESSIVE_HTTP && !it.content.isNullOrBlank()
            }
            val best = progressive.maxByOrNull { it.averageBitrate } ?: return null
            val art = info.thumbnails?.lastOrNull()?.url
            Resolved(best.content, info.name ?: "YouTube", art, info.duration)
        } catch (e: Exception) {
            Log.w(TAG, "YouTube resolveAudio failed for $videoId: ${e.message}")
            null
        }
    }

    /** Playlist/mix URL → ordered videoIds (+ titles/artwork). Empty on failure. */
    fun resolvePlaylist(url: String): List<YtItem> {
        return try {
            val pinfo = PlaylistInfo.getInfo(ServiceList.YouTube, url)
            pinfo.relatedItems.orEmpty().mapNotNull { item ->
                val vid = videoIdFromUrl(item.url) ?: return@mapNotNull null
                val dur = runCatching { item.duration }.getOrDefault(0L).coerceAtLeast(0L)
                YtItem(vid, item.name ?: "YouTube", item.thumbnails?.lastOrNull()?.url, dur)
            }
        } catch (e: Exception) {
            Log.w(TAG, "YouTube resolvePlaylist failed for $url: ${e.message}")
            emptyList()
        }
    }

    /** Extract a YouTube videoId from watch/youtu.be/shorts/embed URLs (or a bare 11-char id). */
    fun videoIdFromUrl(raw: String?): String? {
        val s = raw?.trim() ?: return null
        if (s.isEmpty()) return null
        if (Regex("^[A-Za-z0-9_-]{11}$").matches(s)) return s
        Regex("[?&]v=([A-Za-z0-9_-]{11})").find(s)?.let { return it.groupValues[1] }
        Regex("youtu\\.be/([A-Za-z0-9_-]{11})").find(s)?.let { return it.groupValues[1] }
        Regex("/(?:shorts|embed|v)/([A-Za-z0-9_-]{11})").find(s)?.let { return it.groupValues[1] }
        return null
    }

    /** True if a URL carries a YouTube playlist/mix id we should expand (RD/PL/UU/OLAK/LL/FL). */
    fun playlistIdFromUrl(raw: String?): String? {
        val s = raw ?: return null
        val id = Regex("[?&]list=([A-Za-z0-9_-]+)").find(s)?.groupValues?.get(1) ?: return null
        return if (Regex("^(RD|PL|UU|OLAK|LL|FL)").containsMatchIn(id)) id else null
    }
}
