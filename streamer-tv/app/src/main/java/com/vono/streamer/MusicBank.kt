package com.vono.streamer

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * Native Music Bank / R2 resolver + authorizer (Phase 2A-2). Reuses the EXISTING flow:
 *   1) POST /api/music-bank/authorize (session cookie) → short-lived media token (mt) + allowedGenres
 *   2) GET  /api/streamer/tracks?genre=<g>            → READY tracks (logicalId + title)
 *   3) play each track at /api/media/<logicalId>?mt=<token>  (ExoPlayer follows the 302 to R2)
 * No parallel system; all auth is the WebView session cookie via AuthProvider.
 */
class MusicBank(private val auth: AuthProvider) {
    private val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()

    data class Track(val id: String, val title: String, val genre: String)
    data class Authz(val token: String, val expEpochSec: Long, val allowedGenres: List<String>)

    /** Blocking; call off the main thread. */
    fun authorize(deviceId: String): Authz? {
        val cookie = auth.currentSessionCookie() ?: return null
        return try {
            val body = JSONObject().put("deviceId", deviceId).toString()
                .toRequestBody("application/json".toMediaType())
            val req = Request.Builder()
                .url("${VonoProtocol.APP_ORIGIN}/api/music-bank/authorize")
                .header("Cookie", cookie).header("Accept", "application/json")
                .post(body).build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) { Log.w("VonoStreamer", "authorize HTTP ${resp.code}"); return null }
                val j = JSONObject(resp.body?.string() ?: return null)
                val token = j.optString("token", "").ifBlank { return null }
                val exp = j.optLong("exp", 0L)
                val genres = mutableListOf<String>()
                j.optJSONArray("allowedGenres")?.let { for (i in 0 until it.length()) genres.add(it.optString(i)) }
                Authz(token, exp, genres)
            }
        } catch (e: Exception) { Log.w("VonoStreamer", "authorize failed: ${e.message}"); null }
    }

    /** Blocking; call off the main thread. */
    fun resolveTracks(genre: String?): List<Track> {
        val cookie = auth.currentSessionCookie() ?: return emptyList()
        return try {
            val g = if (genre.isNullOrBlank()) "" else "?genre=" + URLEncoder.encode(genre, "UTF-8")
            val req = Request.Builder()
                .url("${VonoProtocol.APP_ORIGIN}/api/streamer/tracks$g")
                .header("Cookie", cookie).header("Accept", "application/json").get().build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) { Log.w("VonoStreamer", "tracks HTTP ${resp.code}"); return emptyList() }
                val j = JSONObject(resp.body?.string() ?: return emptyList())
                val arr = j.optJSONArray("tracks") ?: return emptyList()
                val out = ArrayList<Track>(arr.length())
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val id = o.optString("id", ""); if (id.isBlank()) continue
                    out.add(Track(id, o.optString("title", id), o.optString("genre", genre ?: "")))
                }
                out
            }
        } catch (e: Exception) { Log.w("VonoStreamer", "resolveTracks failed: ${e.message}"); emptyList() }
    }

    fun mediaUrl(logicalId: String, token: String): String =
        "${VonoProtocol.APP_ORIGIN}/api/media/$logicalId?mt=" + URLEncoder.encode(token, "UTF-8")
}
