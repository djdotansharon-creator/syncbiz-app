package com.vono.streamer

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * VONO Streamer — generic Android TV / Google TV thin shell.
 *
 * Wraps ONLY the existing hosted web streamer engine. No native playback, no
 * WebSocket client, no MASTER/CONTROL logic — the web page does all of that.
 * The shell provides: fullscreen, keep-awake, persistent session, a VISIBLE
 * D-pad Settings button, autoplay-without-gesture, optional start-on-boot, and a
 * conservative startup-only reload.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private lateinit var settingsButton: ImageButton
    private val handler = Handler(Looper.getMainLooper())
    private var retryScheduled = false
    private var retryDelayMs = INITIAL_RETRY_MS
    // Once the streamer document has loaded successfully, we NEVER auto-reload again —
    // a transient sub-resource/media error must not nuke a live, playing session.
    private var hasLoadedStreamerOnce = false

    companion object {
        /** The ONE streamer web engine. Only the hosted URL is wrapped. */
        const val STREAMER_ORIGIN = "https://syncbiz-app-production.up.railway.app"
        const val STREAMER_BASE_URL = "$STREAMER_ORIGIN/streamer?device=streamer&mode=player"
        const val INITIAL_RETRY_MS = 2000L
        const val MAX_RETRY_MS = 30000L
        // TEMPORARY diagnostic tag. Filter logcat with:  adb logcat -s VonoStreamer
        // Remove this logging once the field defect is confirmed fixed.
        private const val TAG = "VonoStreamer"
    }

    private fun streamerUrl(): String {
        val flag = if (Prefs.autoResume(this)) "1" else "0"
        return "$STREAMER_BASE_URL&autoresume=$flag"
    }

    /** True only for the streamer DOCUMENT itself — never for media/API/ws sub-resources. */
    private fun isStreamerDoc(url: String?): Boolean {
        val u = url ?: return false
        return u.startsWith("$STREAMER_ORIGIN/streamer")
    }

    private fun isPlayerPage(url: String?): Boolean = (url ?: "").contains("/streamer")

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Log.d(TAG, "onCreate savedInstanceState=${if (savedInstanceState == null) "null" else "restored"}")

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        webView = WebView(this)

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true                        // localStorage recovery + session
            mediaPlaybackRequiresUserGesture = false        // allow autoplay without a gesture
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)        // persistent login/session
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                Log.d(TAG, "onPageStarted url=$url")
            }

            override fun onPageFinished(view: WebView, url: String?) {
                Log.d(TAG, "onPageFinished url=$url")
                Prefs.setLastLoad(this@MainActivity, "ok")
                retryDelayMs = INITIAL_RETRY_MS
                retryScheduled = false
                if (isPlayerPage(url)) {
                    hasLoadedStreamerOnce = true
                    // Player screen is display-only + remote-controlled → make the Settings
                    // button the sole focus target so D-pad + OK always reaches it.
                    webView.isFocusable = false
                    settingsButton.requestFocus()
                } else {
                    // Login / other pages need keyboard input → let the WebView take focus.
                    webView.isFocusable = true
                    webView.isFocusableInTouchMode = true
                    webView.requestFocus()
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                val url = request.url?.toString() ?: ""
                Log.w(TAG, "onReceivedError mainFrame=${request.isForMainFrame} code=${error.errorCode} desc=${error.description} url=$url")
                // ONLY self-heal the STARTUP case: the streamer document itself failing to
                // load before it ever came up. After a successful load, ignore all errors
                // (incl. main-frame-tagged media/sub-resource errors on some OEM WebViews)
                // so a live session is never reloaded out from under playback.
                if (request.isForMainFrame && isStreamerDoc(url) && !hasLoadedStreamerOnce) {
                    Log.w(TAG, "startup streamer-doc error → scheduleReload")
                    Prefs.setLastLoad(this@MainActivity, "error")
                    scheduleReload()
                } else {
                    Log.d(TAG, "error ignored (not a startup main-doc failure) — session kept")
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                Log.w(TAG, "onReceivedHttpError mainFrame=${request.isForMainFrame} status=${errorResponse.statusCode} url=${request.url}")
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                Log.d(TAG, "navigation url=$url isReload=$isReload")
            }
        }

        // Surface the web engine's own console logs (incl. [SyncBiz Audit] lines) so a
        // "track → NO TRACK LOADED" reset is visible in logcat. TEMPORARY.
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                Log.d(TAG, "[web] ${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
                return true
            }
        }

        // Root = WebView + a visible, D-pad-focusable Settings button overlay.
        val root = FrameLayout(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT),
        )
        val density = resources.displayMetrics.density
        settingsButton = ImageButton(this).apply {
            setImageResource(R.drawable.ic_settings_gear)
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.settings_fab_bg)
            contentDescription = getString(R.string.settings_title)
            isFocusable = true
            isFocusableInTouchMode = false
            val pad = (12 * density).toInt()
            setPadding(pad, pad, pad, pad)
            setOnClickListener { openSettings() }
        }
        val size = (56 * density).toInt()
        val margin = (20 * density).toInt()
        val lp = FrameLayout.LayoutParams(size, size, Gravity.TOP or Gravity.END).apply {
            setMargins(margin, margin, margin, margin)
        }
        root.addView(settingsButton, lp)
        setContentView(root)

        applyImmersive()
        if (savedInstanceState == null) {
            Log.d(TAG, "initial loadUrl ${streamerUrl()}")
            webView.loadUrl(streamerUrl())
        }
    }

    private fun scheduleReload() {
        if (retryScheduled) return
        retryScheduled = true
        val delay = retryDelayMs
        retryDelayMs = (retryDelayMs * 2).coerceAtMost(MAX_RETRY_MS)
        Log.w(TAG, "scheduleReload in ${delay}ms")
        handler.postDelayed({
            retryScheduled = false
            Log.w(TAG, "reload firing → ${streamerUrl()}")
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
        Log.d(TAG, "openSettings")
        startActivity(Intent(this, SettingsActivity::class.java))
    }

    override fun onResume() {
        super.onResume()
        Log.d(TAG, "onResume")
        applyImmersive()
        webView.onResume()
    }

    override fun onPause() {
        Log.d(TAG, "onPause")
        // The shell never clears playback recovery; the engine owns resume.
        webView.onPause()
        super.onPause()
    }

    /**
     * Settings is primarily reached via the on-screen gear (D-pad + OK). MENU and a
     * long-press BACK are kept as fallbacks for remotes that send them.
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
