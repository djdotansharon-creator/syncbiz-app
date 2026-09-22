package com.vono.streamer

import android.util.Log
import org.json.JSONObject

/**
 * Origin-restricted native↔WebView YouTube bridge state (PAGE-LIFETIME).
 *
 * Decouples the foreground Activity (which owns the WebView + the WebMessage
 * JavaScriptReplyProxy) from the background [VonoStreamerService] (which owns MASTER +
 * STATE_UPDATE). Everything here is page-lifetime and foreground-gated:
 *
 *  - `foreground` = MainActivity is resumed/visible.
 *  - `bindReady` is called by MainActivity ONLY when a fresh `ready` message arrives from
 *    the allow-listed VONO main frame (a new page-lifetime reply proxy). This is the ONLY
 *    way the poster is (re)bound — so a stale proxy is never used.
 *  - `clearProxy` is called on pause / reload / navigate: the poster becomes unusable until
 *    the next page sends a fresh `ready`.
 *  - `sendToWeb` forwards a YouTube command to the VONO page ONLY when READY and foreground;
 *    otherwise it returns false and the caller reports BRIDGE_NOT_READY /
 *    YOUTUBE_REQUIRES_FOREGROUND and keeps existing native audio playing.
 *
 * This bridge carries YouTube control only. It never touches MASTER election, the native
 * ExoPlayer engine, or the WS protocol.
 */
object WebViewBridge {
    private const val TAG = "VonoStreamer"

    @Volatile var foreground: Boolean = false
        private set
    @Volatile private var ready: Boolean = false
    /** Posts a JS command string to the VONO main frame (MainActivity wraps this onto the UI thread). */
    @Volatile private var poster: ((String) -> Unit)? = null
    /** The service registers this to receive web→native YouTube state reports. */
    @Volatile var onYouTubeState: ((JSONObject) -> Unit)? = null

    /** True only when a fresh page is READY AND the app is foreground → safe to forward YouTube. */
    val isUsable: Boolean get() = ready && poster != null && foreground

    fun setForeground(f: Boolean) {
        foreground = f
        // Backgrounding invalidates the page-lifetime proxy; require a fresh `ready` on return.
        if (!f) clearProxy()
    }

    /** A fresh `ready` from the allow-listed VONO main frame — (re)bind the page-lifetime poster. */
    fun bindReady(post: (String) -> Unit) {
        poster = post
        ready = true
        Log.d(TAG, "WebViewBridge READY (fresh reply proxy bound)")
    }

    /** Page paused / reloading / navigating — the stored proxy is now stale. */
    fun clearProxy() {
        if (ready) Log.d(TAG, "WebViewBridge proxy cleared (stale)")
        poster = null
        ready = false
    }

    /** Forward a command to the web YouTube player. Returns false if not usable (never uses a stale proxy). */
    fun sendToWeb(json: String): Boolean {
        val p = poster
        if (!ready || p == null || !foreground) return false
        return try {
            p(json)
            true
        } catch (e: Exception) {
            Log.w(TAG, "sendToWeb failed: ${e.message}")
            false
        }
    }

    /** Web→native YouTube state report (from MainActivity's message listener). */
    fun reportFromWeb(obj: JSONObject) {
        onYouTubeState?.invoke(obj)
    }
}
