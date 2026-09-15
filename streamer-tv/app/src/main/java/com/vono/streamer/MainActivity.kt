package com.vono.streamer

import android.annotation.SuppressLint
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
 * It ONLY wraps the existing hosted web streamer engine. There is no native
 * playback, no WebSocket client, and no MASTER/CONTROL logic here — the web page
 * at STREAMER_URL registers as branch_streamer_station and owns MASTER exactly as
 * it does in any browser. This shell just gives it a launcher icon, fullscreen,
 * keep-awake, session persistence, and reload-on-failure.
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
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Continuous branch playback output → never let the screen sleep.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true                       // localStorage streamer flag + session
            mediaPlaybackRequiresUserGesture = false       // autoplay for headless output
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        // Persist login/session across launches.
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                // Recover only main-frame failures (network/server); ignore sub-resources.
                if (request.isForMainFrame) scheduleReload()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                // Good load → reset backoff.
                retryDelayMs = INITIAL_RETRY_MS
                retryScheduled = false
            }
        }

        applyImmersive()
        if (savedInstanceState == null) loadStreamer()
    }

    private fun loadStreamer() {
        webView.loadUrl(STREAMER_URL)
    }

    /** One pending reload at a time, bounded exponential backoff. */
    private fun scheduleReload() {
        if (retryScheduled) return
        retryScheduled = true
        val delay = retryDelayMs
        retryDelayMs = (retryDelayMs * 2).coerceAtMost(MAX_RETRY_MS)
        handler.postDelayed({
            retryScheduled = false
            loadStreamer()
        }, delay)
    }

    private fun applyImmersive() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, webView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onResume() {
        super.onResume()
        applyImmersive()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    /**
     * BACK must not walk WebView history or drop the user to the launcher/home
     * mid-session — keep the streamer on screen. (No webView.goBack(); no finish().)
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
