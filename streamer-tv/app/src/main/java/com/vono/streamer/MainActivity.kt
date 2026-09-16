package com.vono.streamer

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * VONO Streamer — generic Android TV / Google TV thin shell.
 *
 * Wraps ONLY the existing hosted web streamer engine. No native playback, no
 * WebSocket client, no MASTER/CONTROL logic — the web page does all of that and
 * already handles resume via its own localStorage recovery (see AUTO-RESUME below).
 * The shell provides: fullscreen, keep-awake, persistent session, resilient reload,
 * autoplay-without-gesture, optional start-on-boot, and a native Settings screen.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private val handler = Handler(Looper.getMainLooper())
    private var retryScheduled = false
    private var retryDelayMs = INITIAL_RETRY_MS

    companion object {
        /** The ONE streamer web engine. Only the hosted URL is wrapped. */
        const val STREAMER_BASE_URL =
            "https://syncbiz-app-production.up.railway.app/streamer?device=streamer&mode=player"
        const val INITIAL_RETRY_MS = 2000L
        const val MAX_RETRY_MS = 30000L
    }

    /**
     * AUTO-RESUME is owned entirely by the web engine, which persists queue / track /
     * position / volume to its own localStorage recovery and restores it on load.
     *
     * The shell NEVER touches that recovery state. It only tells the engine whether to
     * auto-START playback after a restart, via a URL flag the engine already honors:
     *   Auto-resume ON  → `autoresume=1` → engine restores AND resumes (if it was
     *                     recently playing, per the engine's own window).
     *   Auto-resume OFF → `autoresume=0` → engine still restores the full session
     *                     (playlist, queue, current track, position) but does NOT
     *                     auto-start; the user presses play, and all remote CONTROL
     *                     commands work normally.
     * See restoreAutoplaySuppressed() in lib/playback-provider.tsx.
     */
    private fun streamerUrl(): String {
        val flag = if (Prefs.autoResume(this)) "1" else "0"
        return "$STREAMER_BASE_URL&autoresume=$flag"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true                        // localStorage recovery + session
            mediaPlaybackRequiresUserGesture = false        // allow auto-resume after boot (no gesture)
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)        // persistent login/session
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) {
                    Prefs.setLastLoad(this@MainActivity, "error")
                    scheduleReload()
                }
            }
            override fun onPageFinished(view: WebView, url: String?) {
                Prefs.setLastLoad(this@MainActivity, "ok")
                retryDelayMs = INITIAL_RETRY_MS
                retryScheduled = false
            }
        }

        applyImmersive()
        if (savedInstanceState == null) webView.loadUrl(streamerUrl())
    }

    private fun scheduleReload() {
        if (retryScheduled) return
        retryScheduled = true
        val delay = retryDelayMs
        retryDelayMs = (retryDelayMs * 2).coerceAtMost(MAX_RETRY_MS)
        handler.postDelayed({
            retryScheduled = false
            webView.loadUrl(streamerUrl())
        }, delay)
    }

    private fun applyImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, webView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun openSettings() {
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    override fun onResume() {
        super.onResume()
        applyImmersive()
        webView.onResume()
    }

    override fun onPause() {
        // The shell never clears playback recovery. Auto-resume OFF only suppresses
        // auto-START on the next load (via the autoresume=0 URL flag); the engine still
        // preserves and restores the full session. See streamerUrl().
        webView.onPause()
        super.onPause()
    }

    /**
     * D-pad remotes: MENU or a long-press BACK opens Settings. A short BACK is
     * consumed so the appliance never drops to the launcher / walks history.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_MENU -> { openSettings(); return true }
            KeyEvent.KEYCODE_BACK -> { event.startTracking(); return true }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onKeyLongPress(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) { openSettings(); return true }
        return super.onKeyLongPress(keyCode, event)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
