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
        const val STREAMER_URL =
            "https://syncbiz-app-production.up.railway.app/streamer?device=streamer&mode=player"
        const val INITIAL_RETRY_MS = 2000L
        const val MAX_RETRY_MS = 30000L

        // AUTO-RESUME is owned by the web engine. These are the engine's persistence
        // keys (lib/playback-provider.tsx). The shell only CLEARS them when the user
        // turns Auto-resume OFF — it never implements resume itself.
        // [VERIFY] keep in sync with the web engine's STORAGE_KEY / RECOVERY_STORAGE_KEY.
        private const val JS_CLEAR_RESUME =
            "try{localStorage.removeItem('syncbiz-playback-recovery-v2');" +
                "localStorage.removeItem('syncbiz-playback');}catch(e){}"
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
        if (savedInstanceState == null) webView.loadUrl(STREAMER_URL)
    }

    private fun scheduleReload() {
        if (retryScheduled) return
        retryScheduled = true
        val delay = retryDelayMs
        retryDelayMs = (retryDelayMs * 2).coerceAtMost(MAX_RETRY_MS)
        handler.postDelayed({
            retryScheduled = false
            webView.loadUrl(STREAMER_URL)
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
        // Auto-resume OFF → clear the engine's recovery so the next launch starts
        // fresh. (Best-effort: a hard power-cut before onPause may allow one resume.)
        if (!Prefs.autoResume(this)) {
            try { webView.evaluateJavascript(JS_CLEAR_RESUME, null) } catch (_: Exception) {}
        }
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
