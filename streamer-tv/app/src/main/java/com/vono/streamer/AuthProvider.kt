package com.vono.streamer

import android.util.Log
import android.webkit.CookieManager
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Native auth for the WS REGISTER token — WITHOUT a second login.
 *
 * The WebView UI logs the operator in once and persists the `syncbiz-session` cookie
 * (CookieManager). We read that cookie (CookieManager returns httpOnly cookies too),
 * call GET /api/auth/ws-token, and get a fresh short-lived (60s) JWT for REGISTER.
 * Called before every connect/reconnect, so tokens are always fresh. If no session
 * cookie exists yet (operator hasn't logged in), returns null and the service stays
 * OFFLINE until they log in once in the UI.
 */
class AuthProvider {
    private val http = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    fun currentSessionCookie(): String? =
        CookieManager.getInstance().getCookie(VonoProtocol.APP_ORIGIN)?.takeIf { it.contains("syncbiz-session") }

    /** Blocking; call off the main thread. Returns a fresh ws-token JWT or null. */
    fun fetchWsToken(): String? {
        val cookie = currentSessionCookie() ?: run {
            Log.w("VonoStreamer", "no syncbiz-session cookie yet — operator must log in once in the UI")
            return null
        }
        return try {
            val req = Request.Builder()
                .url(VonoProtocol.WS_TOKEN_URL)
                .header("Cookie", cookie)
                .header("Accept", "application/json")
                .get()
                .build()
            http.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w("VonoStreamer", "ws-token HTTP ${resp.code}")
                    return null
                }
                val body = resp.body?.string() ?: return null
                JSONObject(body).optString("token", "").ifBlank { null }
            }
        } catch (e: Exception) {
            Log.w("VonoStreamer", "ws-token fetch failed: ${e.message}")
            null
        }
    }
}
