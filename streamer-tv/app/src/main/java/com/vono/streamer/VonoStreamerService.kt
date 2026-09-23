package com.vono.streamer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * VonoStreamerService — native appliance service.
 *
 * Phase 1 (shadow): persistent identity + native WS + heartbeat + reconnect + boot-start,
 * NON-MASTER (role=controller). Phase 2A adds the NATIVE AUDIO ENGINE (ExoPlayer): audio
 * lives here, in the foreground service, so it survives HOME/Settings/another app; state is
 * persisted to DataStore and RESTORED on boot (no WebView localStorage).
 *
 * 2A-1 proves the engine + recovery with a directly-playable stream (no WS commands, no
 * MASTER yet). Later slices add Music Bank/R2, WS command execution + STATE_UPDATE, jingles,
 * then the SHADOW→MASTER cutover.
 */
class VonoStreamerService : Service() {

    private lateinit var store: VonoStore
    private lateinit var auth: AuthProvider
    private lateinit var ws: VonoWsClient
    private var netMonitor: NetworkMonitor? = null
    private var player: CrossfadeEngine? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var deviceId = "vono-streamer"

    private lateinit var musicBank: MusicBank
    @Volatile private var queue: List<MusicBank.Track> = emptyList()
    @Volatile private var queueIndex = 0
    @Volatile private var queueGenre: String? = null
    @Volatile private var mediaToken: String? = null
    @Volatile private var mediaTokenExpSec: Long = 0
    @Volatile private var currentKind: String = "stream" // "stream" | "musicbank" | "youtube_pending" | "youtube_webview" | "youtube_native"
    // POC (2A-4): on-device YouTube → NewPipeExtractor resolves → ExoPlayer plays (no WebView).
    // A native YouTube queue (videoId + metadata), resolved per-track on play; recovery re-resolves.
    @Volatile private var ytQ: List<YouTubeResolver.YtItem> = emptyList()
    @Volatile private var ytQIndex = 0
    @Volatile private var ytPrefetch: Pair<String, YouTubeResolver.Resolved>? = null // pre-resolved NEXT item
    private val sharedHttp by lazy { okhttp3.OkHttpClient() } // for NewPipe resolution
    private var jingleMp: android.media.MediaPlayer? = null
    // Jingle ducking state. Native ducking is owned by CrossfadeEngine.setDuck (both decks);
    // ytDucked only tracks the legacy WebView path (unused while POC native YouTube is on).
    @Volatile private var ytDucked: Boolean = false
    private val reclaimTimes = ArrayDeque<Long>() // MASTER reclaim rate-limit

    // YouTube-in-WebView session (foreground compatibility path). Audio lives in the WebView,
    // not ExoPlayer; the service only forwards commands + mirrors the reported state.
    @Volatile private var ytStatus: String = "idle"   // playing | paused | ended | stopped | error | idle
    @Volatile private var ytTitle: String = ""
    @Volatile private var ytVideoId: String = ""      // current video id (from web reports) → thumbnail
    @Volatile private var ytCover: String? = null     // source cover from the original PLAY_SOURCE, if any
    @Volatile private var ytIndex: Int = 0
    @Volatile private var ytCount: Int = 0
    @Volatile private var ytPositionSec: Double = 0.0
    @Volatile private var ytDurationSec: Double = 0.0
    // Queue mirror for CONTROL (title + cover) captured from the PLAY_SOURCE sessionTracks.
    private var ytQueue: List<Pair<String, String?>> = emptyList()
    // Transient marker surfaced to CONTROL when a YouTube request can't run (kept native audio).
    @Volatile private var blockedReason: String? = null

    // ── Boot / network recovery (native sources only; never YouTube) ──────────────
    // The native source the appliance SHOULD be playing. Armed on restore + on every native
    // play; cleared on manual PAUSE/STOP. Recovery waits for network and retries with backoff
    // until it is playing again. Kept as a snapshot JSON (kind + url/title/pos or musicbank).
    @Volatile private var desiredNative: JSONObject? = null
    private var recoveryDelayMs = RECOVERY_MIN_DELAY
    private var recoveryScheduled = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "service onCreate")
        createChannel()
        goForeground(playing = false)

        store = VonoStore(this)
        auth = AuthProvider()
        musicBank = MusicBank(auth)
        ws = VonoWsClient(
            auth,
            deviceIdProvider = { deviceId },
            onCommand = { cmd, payload -> handleCommand(cmd, payload) },
            onMode = { mode -> onDeviceMode(mode) },
        )
        netMonitor = NetworkMonitor(
            this,
            onAvailable = { ws.kick(); main.post { kickRecovery() } }, // network back → retry native recovery
            onLost = {},
        )
        netMonitor?.start()

        // Receive YouTube playback-state reports from the WebView (origin-restricted bridge).
        WebViewBridge.onYouTubeState = { obj -> onYouTubeStateFromWeb(obj) }

        // Native audio engine (created on the main thread). Auto-advances the queue on track end.
        // onError → a native source failed (e.g. no network at boot) → kick the recovery loop.
        player = CrossfadeEngine(
            this,
            onChanged = { onPlaybackChanged() },
            onEnded = { advanceQueue() },
            onError = { main.post { kickRecovery() } },
        ).also { it.setCrossfadeSec(DEFAULT_CROSSFADE_SEC) }

        scope.launch {
            deviceId = runCatching { store.getOrCreateDeviceId() }.getOrDefault(deviceId)
            AppState.deviceId = deviceId
            AppState.notifyChanged()
            ws.start()
            // Restore + resume the persisted session (boot recovery).
            val snap = runCatching { store.readPlaybackState() }.getOrNull()
            if (!snap.isNullOrBlank()) withContext(Dispatchers.Main) { restore(snap) }
        }

        startPositionPersist()
        startCrossfadeWatcher()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_TEST -> main.post {
                currentKind = "stream"; queue = emptyList()
                player?.play(TEST_STREAM_URL, "Native engine test stream")
            }
            ACTION_PLAY_MUSICBANK -> playMusicBankTest()
            ACTION_PLAY_YT_POC -> main.post {
                // Isolated on-device YouTube POC: resolve + play a real music video via NewPipe→ExoPlayer.
                playYouTubeNative(JSONObject().put("url", POC_YT_TEST_URL).put("title", "YouTube POC test"))
            }
            ACTION_NEXT -> main.post { queueNext() }
            ACTION_PREV -> main.post { queuePrev() }
            ACTION_STOP -> main.post { cancelRecovery(); currentKind = "stream"; queue = emptyList(); ytQ = emptyList(); player?.stop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "service onDestroy")
        main.removeCallbacksAndMessages(null)
        netMonitor?.stop()
        WebViewBridge.onYouTubeState = null
        if (this::ws.isInitialized) ws.stop()
        main.post { jingleMp?.release(); jingleMp = null; player?.release() }
        scope.cancel()
        super.onDestroy()
    }

    /**
     * Boot recovery. Restore ONLY a native source (stream/radio or Music Bank) whose persisted
     * status was PLAYING. Never resurrect a paused/stopped session, and never YouTube (which is
     * never persisted). Does NOT play immediately — it ARMS the recovery target, which waits for
     * network and retries with backoff (see armRecovery). Prevents the cold-boot race where the
     * URL is requested before Wi-Fi is up.
     */
    private fun restore(json: String) {
        try {
            val o = JSONObject(json)
            val kind = o.optString("kind", "stream")
            val status = o.optString("status", "")
            val vol = o.optInt("volumePct", 100)
            player?.setVolume(vol / 100f)
            if (status != "playing") return                 // only resume a session that WAS playing
            if (kind != "stream" && kind != "musicbank" && kind != "youtube_native") return // native kinds only
            if (kind == "stream" && o.optString("url", "").isBlank()) return
            if (kind == "musicbank" && (o.optJSONArray("tracks")?.length() ?: 0) == 0) return
            if (kind == "youtube_native" && (o.optJSONArray("ytItems")?.length() ?: 0) == 0) return
            Log.d(TAG, "boot restore → arming recovery (kind=$kind)")
            armRecovery(o)
        } catch (e: Exception) {
            Log.w(TAG, "restore failed: ${e.message}")
        }
    }

    /** Called on the main thread by NativePlayer on every transition. */
    private fun onPlaybackChanged() {
        val p = player ?: return
        goForeground(playing = p.isPlaying() || p.currentUrl != null)
        // Do NOT persist a YouTube session as a resumable native snapshot (YouTube can't be
        // resumed natively, and requires foreground). Only persist native URL/Radio/Music Bank.
        if (currentKind != "youtube_webview" && currentKind != "youtube_pending") {
            val snap = JSONObject().apply {
                put("kind", currentKind)
                put("status", if (p.isPlaying()) "playing" else "paused")
                put("positionMs", p.positionMs())
                put("volumePct", (p.volume() * 100).toInt())
                put("updatedAt", System.currentTimeMillis())
                if (currentKind == "musicbank") {
                    put("genre", queueGenre ?: "")
                    put("index", queueIndex)
                    val arr = org.json.JSONArray()
                    for (t in queue) arr.put(JSONObject().put("id", t.id).put("title", t.title).put("genre", t.genre))
                    put("tracks", arr)
                } else if (currentKind == "youtube_native") {
                    // Persist videoIds (NOT the expiring googlevideo URL) — recovery re-resolves.
                    put("index", ytQIndex)
                    val arr = org.json.JSONArray()
                    for (it in ytQ) arr.put(JSONObject().put("videoId", it.videoId).put("title", it.title).put("artwork", it.artwork ?: ""))
                    put("ytItems", arr)
                } else {
                    put("url", p.currentUrl ?: "")
                    put("title", p.currentTitle)
                }
            }
            scope.launch { runCatching { store.writePlaybackState(snap.toString()) } }
            // Keep the recovery target tracking the CURRENT native playing source (replaces any
            // older target). Only while actually playing — a manual PAUSE clears it via cancelRecovery.
            if (p.isPlaying() && (p.currentUrl != null || currentKind == "musicbank")) {
                desiredNative = snap
                recoveryDelayMs = RECOVERY_MIN_DELAY
            }
        }
        // Publish live playback state to CONTROL (phone/web mirror). Cutover only.
        publishState()
    }

    // ── Music Bank native queue (Phase 2A-2) ─────────────────────────────────────
    private fun playMusicBankTest() {
        scope.launch {
            val authz = musicBank.authorize(deviceId)
            if (authz == null) {
                AppState.lastError = "Music Bank authorize failed — log in once in the app"; AppState.notifyChanged()
                return@launch
            }
            mediaToken = authz.token; mediaTokenExpSec = authz.expEpochSec
            val genre = authz.allowedGenres.firstOrNull()
            val tracks = musicBank.resolveTracks(genre)
            if (tracks.isEmpty()) {
                AppState.lastError = "No READY Music Bank tracks for genre=$genre"; AppState.notifyChanged()
                return@launch
            }
            queue = tracks; queueGenre = genre; queueIndex = 0; currentKind = "musicbank"
            Log.d(TAG, "Music Bank queue: ${tracks.size} tracks, genre=$genre")
            withContext(Dispatchers.Main) { playCurrentTrack() }
        }
    }

    /** Re-authorize if the media token is missing or within 30s of expiry. Blocking; off-main. */
    private fun ensureTokenFresh() {
        val now = System.currentTimeMillis() / 1000
        if (mediaToken == null || mediaTokenExpSec - now < 30) {
            musicBank.authorize(deviceId)?.let { mediaToken = it.token; mediaTokenExpSec = it.expEpochSec }
        }
    }

    /** Called on the main thread. Fetches a fresh token (IO) then plays the current queue track. */
    private fun playCurrentTrack(positionMs: Long = 0L) {
        val t = queue.getOrNull(queueIndex) ?: return
        scope.launch {
            ensureTokenFresh()
            val token = mediaToken ?: return@launch
            val url = musicBank.mediaUrl(t.id, token)
            // Resume (positionMs>0, boot/recovery) = hard play; advance/first = A/B crossfade.
            withContext(Dispatchers.Main) {
                if (positionMs > 0) player?.play(url, t.title, positionMs) else player?.crossfadeTo(url, t.title)
            }
        }
    }

    private fun advanceQueue() {
        if (currentKind == "youtube_native") { if (ytQIndex < ytQ.size - 1) { ytQIndex++; playCurrentYt() }; return }
        if (currentKind != "musicbank") return
        if (queueIndex < queue.size - 1) { queueIndex++; playCurrentTrack() }
    }
    private fun queueNext() {
        if (currentKind == "youtube_native") { if (ytQIndex < ytQ.size - 1) { ytQIndex++; playCurrentYt() }; return }
        if (currentKind == "musicbank" && queueIndex < queue.size - 1) { queueIndex++; playCurrentTrack() }
    }
    private fun queuePrev() {
        if (currentKind == "youtube_native") { if (ytQIndex > 0) { ytQIndex--; playCurrentYt() }; return }
        if (currentKind == "musicbank" && queueIndex > 0) { queueIndex--; playCurrentTrack() }
    }

    // ── POC (2A-4): on-device YouTube → NewPipe → ExoPlayer (no WebView) ───────────
    /** Resolve a YouTube PLAY_SOURCE (single video or playlist/mix) into a native queue and play. */
    private fun playYouTubeNative(source: JSONObject) {
        val url = source.optString("url", "")
        val title = source.optString("title", "")
        scope.launch {
            YouTubeResolver.ensureInit(sharedHttp)
            val listId = YouTubeResolver.playlistIdFromUrl(url)
            val items: List<YouTubeResolver.YtItem> = when {
                listId != null -> YouTubeResolver.resolvePlaylist(url)
                else -> YouTubeResolver.videoIdFromUrl(url)?.let {
                    listOf(YouTubeResolver.YtItem(it, title.ifBlank { "YouTube" }, null))
                } ?: emptyList()
            }
            if (items.isEmpty()) {
                AppState.lastError = "YouTube resolve failed (no playable audio)"; AppState.notifyChanged()
                withContext(Dispatchers.Main) { blockedReason = "YOUTUBE_RESOLVE_FAILED"; publishState() }
                return@launch
            }
            withContext(Dispatchers.Main) {
                ytQ = items; ytQIndex = 0; currentKind = "youtube_native"
                queue = emptyList()
                Log.d(TAG, "YouTube native queue: ${items.size} item(s)")
                playCurrentYt()
            }
        }
    }

    /** Resolve the current YouTube queue item's audio URL (IO) and play it via ExoPlayer. */
    private fun playCurrentYt(positionMs: Long = 0L) {
        val item = ytQ.getOrNull(ytQIndex) ?: return
        // Reflect the selected track immediately (title/artwork) even before the URL resolves.
        ytTitle = item.title; ytVideoId = item.videoId
        // Gap-free advance: use the pre-resolved next item if it matches (see prefetchNextYt).
        val cached = ytPrefetch?.takeIf { it.first == item.videoId }?.second
        if (cached != null) {
            ytPrefetch = null
            ytTitle = cached.title; blockedReason = null
            startYtAudio(cached.audioUrl, cached.title, positionMs)
            prefetchNextYt()
            return
        }
        scope.launch {
            YouTubeResolver.ensureInit(sharedHttp)
            val r = YouTubeResolver.resolveAudio(item.videoId)
            if (r == null) {
                AppState.lastError = "YouTube resolve failed: ${item.videoId}"; AppState.notifyChanged()
                withContext(Dispatchers.Main) { blockedReason = "YOUTUBE_RESOLVE_FAILED"; publishState() }
                return@launch
            }
            withContext(Dispatchers.Main) {
                ytTitle = r.title; blockedReason = null
                startYtAudio(r.audioUrl, r.title, positionMs)
                prefetchNextYt()
            }
        }
    }

    /** Resume (positionMs>0) = hard play; advance/first = A/B crossfade. */
    private fun startYtAudio(url: String, title: String, positionMs: Long) {
        if (positionMs > 0) player?.play(url, title, positionMs) else player?.crossfadeTo(url, title)
    }

    /** Pre-resolve the NEXT YouTube item so the crossfade overlap is gap-free. Best-effort. */
    private fun prefetchNextYt() {
        val next = ytQ.getOrNull(ytQIndex + 1) ?: run { ytPrefetch = null; return }
        if (ytPrefetch?.first == next.videoId) return
        scope.launch {
            YouTubeResolver.ensureInit(sharedHttp)
            val r = YouTubeResolver.resolveAudio(next.videoId) ?: return@launch
            ytPrefetch = next.videoId to r
        }
    }

    // ── 2A-3 cutover: CONTROL commands + MASTER + STATE_UPDATE ────────────────────
    private fun onDeviceMode(mode: String) {
        Log.d(TAG, "device mode = $mode")
        // Appliance priority: if bumped to CONTROL, re-claim MASTER (rate-limited so we never
        // ping-pong forever — the WebView streamer yields via its own loop-breaker).
        if (mode == "CONTROL") {
            val now = System.currentTimeMillis()
            while (reclaimTimes.isNotEmpty() && now - reclaimTimes.first() > 60_000) reclaimTimes.removeFirst()
            if (reclaimTimes.size < 3) { reclaimTimes.addLast(now); ws.claimMaster(); Log.d(TAG, "re-claiming MASTER") }
        }
    }

    private fun handleCommand(command: String, payload: JSONObject?) {
        main.post {
            // YouTube-in-WebView session: transport goes to the foreground web player, not ExoPlayer.
            if (currentKind == "youtube_webview" || currentKind == "youtube_pending") {
                when (command) {
                    "PLAY" -> forwardYt("resume")
                    "PAUSE" -> forwardYt("pause")
                    "STOP" -> { forwardYt("stop"); currentKind = "stream" }
                    "NEXT" -> forwardYt("next")
                    "PREV" -> forwardYt("prev")
                    "SEEK" -> { val s = payload?.optDouble("position", -1.0) ?: -1.0; if (s >= 0) forwardYt("seek", JSONObject().put("position", s)) }
                    "SET_VOLUME" -> { val v = payload?.optInt("volume", -1) ?: -1; if (v in 0..100) forwardYt("volume", JSONObject().put("volume", v)) }
                    "PLAY_SOURCE" -> routeSource(payload) // may switch to native or another YouTube
                    "PLAY_INTERRUPT" -> playJingle(payload)
                    else -> Log.d(TAG, "unhandled command (youtube): $command")
                }
                publishState()
                return@post
            }
            when (command) {
                "PLAY" -> player?.resume()
                // Manual PAUSE/STOP cancels pending boot/network recovery so nothing auto-resurrects.
                "PAUSE" -> { cancelRecovery(); player?.pause() }
                "STOP" -> { cancelRecovery(); currentKind = "stream"; queue = emptyList(); ytQ = emptyList(); player?.stop() }
                "NEXT" -> queueNext()
                "PREV" -> queuePrev()
                "SEEK" -> { val s = payload?.optDouble("position", -1.0) ?: -1.0; if (s >= 0) player?.seekTo((s * 1000).toLong()) }
                "SET_VOLUME" -> { val v = payload?.optInt("volume", -1) ?: -1; if (v in 0..100) player?.setVolume(v / 100f) }
                "PLAY_SOURCE" -> routeSource(payload)
                "PLAY_INTERRUPT" -> playJingle(payload)
                else -> Log.d(TAG, "unhandled command: $command")
            }
            onPlaybackChanged()
        }
    }

    /** Route a PLAY_SOURCE by type: native for URL/radio/Music Bank; YouTube = unsupported. */
    private fun routeSource(payload: JSONObject?) {
        val p = payload?.optJSONObject("source") ?: return
        val url = p.optString("url", "")
        val title = p.optString("title", "")
        val id = p.optString("id", "")
        val type = p.optString("type", "").lowercase()
        val origin = p.optString("origin", "").lowercase()
        val low = url.lowercase()
        val isYouTube = low.contains("youtube.com") || low.contains("youtu.be") || type.contains("youtube")
        // Any non-YouTube source takes over the native engine → stop a YouTube WebView session
        // FIRST (avoid double audio), then start native.
        if (!isYouTube) stopYtIfActive()
        when {
            isYouTube && POC_NATIVE_YOUTUBE -> { blockedReason = null; playYouTubeNative(p) } // on-device NewPipe → ExoPlayer
            isYouTube -> playYouTubeForeground(p) // legacy WebView fallback (kept, unused while POC on)
            low.contains("/api/media/") -> { blockedReason = null; playMusicBankUrl(url, title) } // R2 (needs token)
            url.startsWith("http") -> { blockedReason = null; currentKind = "stream"; queue = emptyList(); ytQ = emptyList(); player?.crossfadeTo(url, title) } // direct audio / radio
            else -> reportUnsupported(id, title, "Unsupported source type ($type/$origin) on the streamer")
        }
    }

    /**
     * YouTube compatibility path: forward the source to the foreground WebView's dedicated
     * YouTube player over the origin-restricted bridge. Native ExoPlayer is stopped ONLY after
     * the WebView confirms "playing" (see onYouTubeStateFromWeb). If the app is not foreground
     * or the bridge isn't READY, keep current native audio and report a clear blocked reason.
     */
    private fun playYouTubeForeground(source: JSONObject) {
        val url = source.optString("url", "")
        val title = source.optString("title", "")
        val urls = org.json.JSONArray()
        val queue = ArrayList<Pair<String, String?>>()
        source.optJSONArray("sessionTracks")?.let { st ->
            for (i in 0 until st.length()) {
                val t = st.optJSONObject(i) ?: continue
                val u = t.optString("url", "")
                if (u.isNotBlank()) {
                    urls.put(u)
                    val c = t.optString("cover", "")
                    queue.add((t.optString("title", "").ifBlank { title }) to (c.ifBlank { null }))
                }
            }
        }
        if (urls.length() == 0 && url.isNotBlank()) urls.put(url)
        // Capture queue + source cover for the CONTROL mirror; reset per-track fields.
        ytQueue = queue
        ytCover = source.optString("cover", "").ifBlank { null }
        ytIndex = 0
        ytCount = if (queue.isNotEmpty()) queue.size else 1
        ytVideoId = ""
        val msg = JSONObject().apply {
            put("t", "play"); put("url", url); put("title", title); put("urls", urls)
        }
        if (WebViewBridge.sendToWeb(msg.toString())) {
            currentKind = "youtube_pending"       // don't stop native audio until confirmed playing
            ytTitle = title; ytStatus = "loading"; blockedReason = null
            Log.d(TAG, "YouTube forwarded to WebView: $title (${ytCount} track(s))")
            publishState()
        } else {
            blockedReason = if (WebViewBridge.foreground) "BRIDGE_NOT_READY" else "YOUTUBE_REQUIRES_FOREGROUND"
            Log.w(TAG, "YouTube rejected ($blockedReason) — native audio kept")
            publishState()
        }
    }

    /** Stop a YouTube WebView session (best-effort; no-op if none / bridge unusable). */
    private fun stopYtIfActive() {
        if (currentKind == "youtube_webview" || currentKind == "youtube_pending") {
            WebViewBridge.sendToWeb(JSONObject().put("t", "stop").toString())
        }
    }

    /** Forward a transport command to the WebView YouTube player. */
    private fun forwardYt(t: String, extra: JSONObject? = null) {
        val msg = (extra ?: JSONObject()).put("t", t)
        if (!WebViewBridge.sendToWeb(msg.toString())) {
            blockedReason = if (WebViewBridge.foreground) "BRIDGE_NOT_READY" else "YOUTUBE_REQUIRES_FOREGROUND"
            publishState()
        }
    }

    /** Web→native YouTube state report → mirror into the branch STATE_UPDATE. */
    private fun onYouTubeStateFromWeb(obj: JSONObject) {
        when (obj.optString("t")) {
            "yt_pos" -> {
                ytPositionSec = obj.optDouble("position", ytPositionSec)
                ytDurationSec = obj.optDouble("duration", ytDurationSec)
                // Heartbeat carries the live video id/title so a track change is never missed.
                obj.optString("videoId", "").takeIf { it.isNotBlank() }?.let { ytVideoId = it }
                obj.optString("title", "").takeIf { it.isNotBlank() }?.let { ytTitle = it }
                if (currentKind == "youtube_webview") publishState()
            }
            "yt" -> {
                val status = obj.optString("status", "")
                ytTitle = obj.optString("title", ytTitle)
                // Fresh per-track metadata (never stale): current video id + playlist index/count.
                obj.optString("videoId", "").takeIf { it.isNotBlank() }?.let { ytVideoId = it }
                if (obj.has("index")) ytIndex = obj.optInt("index", ytIndex).coerceAtLeast(0)
                if (obj.has("count")) ytCount = obj.optInt("count", ytCount).coerceAtLeast(1)
                ytPositionSec = obj.optDouble("position", ytPositionSec)
                ytDurationSec = obj.optDouble("duration", ytDurationSec)
                when (status) {
                    "playing" -> {
                        // Confirmed YouTube audio → NOW stop native ExoPlayer (safe handoff, no gap).
                        // Cancel native recovery: the user deliberately switched to YouTube, so a
                        // network blip must NOT auto-resurrect the previous radio/URL under YouTube.
                        if (currentKind == "youtube_pending" || currentKind == "youtube_webview") {
                            currentKind = "youtube_webview"
                            main.post { cancelRecovery(); player?.stop() }
                        }
                        ytStatus = "playing"; blockedReason = null
                    }
                    "paused" -> ytStatus = "paused"
                    "ended", "stopped" -> {
                        ytStatus = status
                        if (currentKind == "youtube_webview" || currentKind == "youtube_pending") currentKind = "stream"
                    }
                    "error" -> ytStatus = "error"
                }
                publishState()
            }
        }
    }

    /** Play an /api/media/<id> URL by appending a fresh media token. */
    private fun playMusicBankUrl(baseUrl: String, title: String) {
        scope.launch {
            ensureTokenFresh()
            val token = mediaToken
            val full = if (token != null && !baseUrl.contains("mt=")) {
                baseUrl + (if (baseUrl.contains("?")) "&" else "?") + "mt=" + java.net.URLEncoder.encode(token, "UTF-8")
            } else baseUrl
            withContext(Dispatchers.Main) { currentKind = "stream"; queue = emptyList(); ytQ = emptyList(); player?.crossfadeTo(full, title) }
        }
    }

    /**
     * A source the streamer appliance cannot play natively (e.g. YouTube). Per the quality bar
     * we do NOT silence whatever is currently playing — we keep audio alive and just report a
     * clear "unsupported/deferred" marker to CONTROL. No native playback, no double audio.
     */
    private fun reportUnsupported(id: String, title: String, reason: String) {
        Log.w(TAG, "unsupported source: $reason ($title)")
        AppState.lastError = reason; AppState.notifyChanged()
        val base = buildState() // preserves whatever is actually playing
        base.put("unsupportedSource", JSONObject().put("id", id).put("title", title).put("reason", reason))
        ws.sendStateUpdate(base)
    }

    private fun buildState(): JSONObject {
        // POC on-device YouTube: audio IS ExoPlayer, but title/artwork/queue come from the native
        // YouTube queue (artwork derived from the current videoId thumbnail).
        if (currentKind == "youtube_native") {
            val p = player
            val cur = ytQ.getOrNull(ytQIndex)
            val titleSafe = (cur?.title ?: ytTitle).ifBlank { "YouTube" }
            val vid = cur?.videoId ?: ytVideoId
            val cover: Any = cur?.artwork?.takeIf { it.isNotBlank() }
                ?: if (vid.isNotBlank()) "https://i.ytimg.com/vi/$vid/hqdefault.jpg" else JSONObject.NULL
            val arr = org.json.JSONArray()
            for ((i, it) in ytQ.withIndex()) {
                val c: Any = it.artwork?.takeIf { a -> a.isNotBlank() }
                    ?: if (it.videoId.isNotBlank()) "https://i.ytimg.com/vi/${it.videoId}/hqdefault.jpg" else JSONObject.NULL
                arr.put(JSONObject().put("id", it.videoId.ifBlank { "yt_$i" }).put("title", it.title.ifBlank { "YouTube" }).put("cover", c))
            }
            val playing = p?.isPlaying() == true
            return JSONObject().apply {
                put("status", if (playing) "playing" else "paused")
                put("currentTrack", JSONObject().put("title", titleSafe).put("cover", cover))
                put("currentSource", JSONObject().put("id", "youtube").put("title", titleSafe).put("cover", cover))
                put("currentTrackIndex", ytQIndex)
                put("queue", arr)
                put("queueIndex", ytQIndex)
                put("position", (p?.positionMs() ?: 0L) / 1000.0)
                put("duration", (p?.durationMs() ?: 0L) / 1000.0)
                put("positionAt", System.currentTimeMillis())
                put("volume", ((p?.volume() ?: 1f) * 100).toInt())
                put("playbackVia", "youtube_native")
                blockedReason?.let { put("blockedReason", it) }
            }
        }
        // YouTube-in-WebView session: audio + truth live in the WebView; mirror its reported state.
        if (currentKind == "youtube_webview" || currentKind == "youtube_pending") {
            val ytTitleSafe = ytTitle.ifBlank { "YouTube" }
            // Thumbnail priority: (1) the source/track cover from the original PLAY_SOURCE,
            // (2) derive from the current YouTube video id. Never keep a stale first-track cover.
            val cover: Any = when {
                !ytCover.isNullOrBlank() -> ytCover as String
                ytVideoId.isNotBlank() -> "https://i.ytimg.com/vi/$ytVideoId/hqdefault.jpg"
                else -> JSONObject.NULL
            }
            val idx = ytIndex.coerceIn(0, (if (ytCount > 0) ytCount - 1 else 0))
            // Queue mirror for CONTROL: prefer the captured sessionTracks; else a minimal
            // ytCount-long list so the controller shows a real queue + enables NEXT/PREV.
            val queueArr = org.json.JSONArray()
            if (ytQueue.isNotEmpty()) {
                for ((i, t) in ytQueue.withIndex()) {
                    val c: Any = t.second?.takeIf { it.isNotBlank() } ?: (if (i == idx) cover else JSONObject.NULL)
                    queueArr.put(JSONObject().put("id", "yt_$i").put("title", t.first.ifBlank { ytTitleSafe }).put("cover", c))
                }
            } else if (ytCount > 1) {
                for (i in 0 until ytCount) {
                    val isCur = i == idx
                    queueArr.put(
                        JSONObject().put("id", "yt_$i")
                            .put("title", if (isCur) ytTitleSafe else "YouTube")
                            .put("cover", if (isCur) cover else JSONObject.NULL),
                    )
                }
            } else {
                queueArr.put(JSONObject().put("id", "yt_0").put("title", ytTitleSafe).put("cover", cover))
            }
            return JSONObject().apply {
                put("status", if (currentKind == "youtube_pending") "playing" else ytStatus.ifBlank { "playing" })
                put("currentTrack", JSONObject().put("title", ytTitleSafe).put("cover", cover))
                put("currentSource", JSONObject().put("id", "youtube").put("title", ytTitleSafe).put("cover", cover))
                put("currentTrackIndex", idx)
                put("queue", queueArr)
                put("queueIndex", idx)
                put("position", ytPositionSec)
                put("duration", ytDurationSec)
                put("positionAt", System.currentTimeMillis())
                put("volume", ((player?.volume() ?: 1f) * 100).toInt())
                put("playbackVia", "youtube_webview")
                blockedReason?.let { put("blockedReason", it) }
            }
        }
        val p = player
        val playing = p?.isPlaying() == true
        val title = p?.currentTitle ?: ""
        val hasTrack = title.isNotBlank() || (p?.currentUrl != null)
        return JSONObject().apply {
            put("status", if (playing) "playing" else if (hasTrack) "paused" else "idle")
            if (hasTrack) {
                put("currentTrack", JSONObject().put("title", title).put("cover", JSONObject.NULL))
                put("currentSource", JSONObject().put("id", queue.getOrNull(queueIndex)?.id ?: "native").put("title", title).put("cover", JSONObject.NULL))
            } else {
                put("currentTrack", JSONObject.NULL); put("currentSource", JSONObject.NULL)
            }
            put("currentTrackIndex", queueIndex)
            val arr = org.json.JSONArray()
            for (t in queue) arr.put(JSONObject().put("id", t.id).put("title", t.title).put("cover", JSONObject.NULL))
            put("queue", arr)
            put("queueIndex", queueIndex)
            put("position", (p?.positionMs() ?: 0L) / 1000.0)
            put("duration", (p?.durationMs() ?: 0L) / 1000.0)
            put("positionAt", System.currentTimeMillis())
            put("volume", ((p?.volume() ?: 1f) * 100).toInt())
            // Surface a transient YouTube-blocked marker (e.g. YOUTUBE_REQUIRES_FOREGROUND) while
            // native audio keeps playing, so CONTROL can explain why YouTube didn't start.
            blockedReason?.let { put("blockedReason", it) }
        }
    }

    /** Publish the current STATE_UPDATE to CONTROL (no recovery persistence). */
    private fun publishState() {
        if (!VonoProtocol.SHADOW_MODE && this::ws.isInitialized) {
            runCatching { ws.sendStateUpdate(buildState()) }
        }
    }

    /**
     * On-Air jingle (PLAY_INTERRUPT). The main music CONTINUES underneath at DUCK_FACTOR (20%)
     * of its prior volume; the exact prior volume is restored when the jingle ends/errors.
     * Works for native (Radio/URL/Music Bank) and foreground YouTube (ducked via the WebView
     * bridge). The music is never stopped/paused (the jingle is a separate MediaPlayer stream;
     * ExoPlayer keeps audio focus). Overlapping jingles keep the ORIGINAL pre-duck level (we
     * duck once and restore once) and never corrupt restore state. A fail-safe guard restores
     * after JINGLE_MAX_MS in case the jingle stalls.
     */
    private fun playJingle(payload: JSONObject?) {
        val raw = payload?.optString("url", "") ?: return
        if (raw.isBlank()) return
        val abs = if (raw.startsWith("/")) VonoProtocol.APP_ORIGIN + raw else raw
        main.post {
            duckForJingle() // duck once; a second overlapping jingle won't re-capture/re-duck
            // Replace any in-flight jingle WITHOUT disturbing the saved duck level (clear its
            // listeners first so releasing the old player does not trigger a premature restore).
            jingleMp?.let { it.setOnCompletionListener(null); it.setOnErrorListener(null); runCatching { it.release() } }
            jingleMp = null
            main.removeCallbacks(jingleGuard)
            val mp = android.media.MediaPlayer()
            jingleMp = mp
            try {
                mp.setAudioAttributes(
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC).build(),
                )
                mp.setDataSource(abs)
                mp.setOnCompletionListener { m -> if (jingleMp === m) { runCatching { m.release() }; jingleMp = null; main.removeCallbacks(jingleGuard); restoreAfterJingle() } }
                mp.setOnErrorListener { m, _, _ -> if (jingleMp === m) { runCatching { m.release() }; jingleMp = null; main.removeCallbacks(jingleGuard); restoreAfterJingle() }; true }
                mp.setOnPreparedListener { it.start() }
                mp.prepareAsync()
                main.postDelayed(jingleGuard, JINGLE_MAX_MS) // fail-safe: never stay ducked forever
            } catch (e: Exception) {
                Log.w(TAG, "jingle failed: ${e.message}")
                jingleMp = null
                restoreAfterJingle()
            }
        }
    }

    /** Fail-safe restore if a jingle never completes. */
    private val jingleGuard = Runnable {
        jingleMp?.let { it.setOnCompletionListener(null); it.setOnErrorListener(null); runCatching { it.release() } }
        jingleMp = null
        restoreAfterJingle()
    }

    /** Duck the CURRENT audio to DUCK_FACTOR. The engine applies it to BOTH decks and keeps it
     *  in-envelope through crossfades; overlapping jingles keep the same duck (idempotent). */
    private fun duckForJingle() {
        if (currentKind == "youtube_webview" || currentKind == "youtube_pending") {
            // Legacy WebView path (unused while POC_NATIVE_YOUTUBE routes YouTube to the native engine).
            if (!ytDucked) {
                ytDucked = true
                WebViewBridge.sendToWeb(JSONObject().put("t", "duck").put("factor", DUCK_FACTOR.toDouble()).toString())
            }
        } else {
            player?.setDuck(true, DUCK_FACTOR) // native (Radio/URL/Music Bank/YouTube) — both A/B decks
        }
    }

    /** Restore master volume (both decks) and/or un-duck the legacy WebView player. */
    private fun restoreAfterJingle() {
        player?.setDuck(false, 1f)
        if (ytDucked) {
            ytDucked = false
            WebViewBridge.sendToWeb(JSONObject().put("t", "unduck").toString())
        }
    }

    // ── Auto-advance crossfade: start the overlap BEFORE the current track ends ────
    @Volatile private var autoXfadeArmedKey: String? = null
    private fun startCrossfadeWatcher() {
        main.postDelayed(object : Runnable {
            override fun run() {
                maybeAutoCrossfade()
                main.postDelayed(this, 1000)
            }
        }, 1000)
    }
    private fun maybeAutoCrossfade() {
        val p = player ?: return
        if (p.isCrossfading() || !p.isPlaying()) return
        val hasNext = when (currentKind) {
            "musicbank" -> queueIndex < queue.size - 1
            "youtube_native" -> ytQIndex < ytQ.size - 1
            else -> false // radio/direct URL: single stream, nothing to crossfade into
        }
        if (!hasNext) return
        val dur = p.durationMs(); if (dur <= 0) return
        val remaining = dur - p.positionMs()
        val key = "$currentKind:${if (currentKind == "musicbank") queueIndex else ytQIndex}"
        if (remaining in 1..(DEFAULT_CROSSFADE_SEC * 1000L + 750L) && autoXfadeArmedKey != key) {
            autoXfadeArmedKey = key
            Log.d(TAG, "auto-crossfade → advancing before end ($key, ${remaining}ms left)")
            advanceQueue() // increments the index and crossfades into the next track
        }
    }

    /** Persist position every 5s while playing (survives a hard power-cut). */
    private fun startPositionPersist() {
        main.postDelayed(object : Runnable {
            override fun run() {
                if (player?.isPlaying() == true) onPlaybackChanged()
                main.postDelayed(this, 5000)
            }
        }, 5000)
    }

    // ── Boot / network recovery for native sources ────────────────────────────────
    /** Live connectivity check (not just the cached flag) so boot recovery waits for the network. */
    private fun hasNetworkNow(): Boolean {
        return try {
            val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? android.net.ConnectivityManager
            val net = cm?.activeNetwork
            val caps = if (cm != null && net != null) cm.getNetworkCapabilities(net) else null
            caps?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        } catch (_: Exception) {
            AppState.hasNetwork
        }
    }

    /** Arm (or replace) the native recovery target and begin recovery. Native kinds only. */
    private fun armRecovery(target: JSONObject) {
        desiredNative = target
        recoveryDelayMs = RECOVERY_MIN_DELAY
        main.removeCallbacks(recoveryTick)
        recoveryScheduled = false
        recoveryTick.run() // immediate attempt (gated on network) + schedules backoff retries
    }

    /** Manual PAUSE/STOP cancels any pending recovery so we never auto-resurrect a source. */
    private fun cancelRecovery() {
        desiredNative = null
        recoveryScheduled = false
        recoveryDelayMs = RECOVERY_MIN_DELAY
        main.removeCallbacks(recoveryTick)
    }

    /** Network returned / playback error → restart the retry loop promptly (if a target is armed). */
    private fun kickRecovery() {
        if (desiredNative == null || player?.isPlaying() == true) return
        recoveryDelayMs = RECOVERY_MIN_DELAY
        if (!recoveryScheduled) recoveryTick.run()
    }

    /** True when we must NOT (re)issue play() — already playing, or the same source is mid-load. */
    private fun onTargetAlready(o: JSONObject): Boolean {
        val p = player ?: return false
        if (p.isPlaying()) return true
        return when (o.optString("kind", "stream")) {
            "musicbank" -> p.isActive() && currentKind == "musicbank"
            "youtube_native" -> p.isActive() && currentKind == "youtube_native" // buffering → don't re-resolve
            else -> p.isActive() && p.currentUrl == o.optString("url", "") && !p.currentUrl.isNullOrBlank()
        }
    }

    private val recoveryTick = object : Runnable {
        override fun run() {
            recoveryScheduled = false
            val target = desiredNative ?: return          // cancelled by PAUSE/STOP
            if (player?.isPlaying() == true) { recoveryDelayMs = RECOVERY_MIN_DELAY; return } // success → stop loop
            if (hasNetworkNow() && !onTargetAlready(target)) playDesiredNative(target)
            // Reschedule with backoff while we wait for network / buffering / a retry to take.
            if (!recoveryScheduled && desiredNative != null) {
                recoveryScheduled = true
                main.postDelayed(this, recoveryDelayMs)
                recoveryDelayMs = (recoveryDelayMs * 2).coerceAtMost(RECOVERY_MAX_DELAY)
            }
        }
    }

    /** Play the armed native target: stream, Music Bank, or on-device YouTube (re-resolved). */
    private fun playDesiredNative(o: JSONObject) {
        val kind = o.optString("kind", "stream")
        val pos = o.optLong("positionMs", 0L)
        if (kind == "youtube_native") {
            val arr = o.optJSONArray("ytItems") ?: return
            val list = ArrayList<YouTubeResolver.YtItem>(arr.length())
            for (i in 0 until arr.length()) {
                val t = arr.optJSONObject(i) ?: continue
                val vid = t.optString("videoId", ""); if (vid.isBlank()) continue
                list.add(YouTubeResolver.YtItem(vid, t.optString("title", "YouTube"), t.optString("artwork", "").ifBlank { null }))
            }
            if (list.isEmpty()) return
            ytQ = list
            ytQIndex = o.optInt("index", 0).coerceIn(0, list.size - 1)
            currentKind = "youtube_native"; queue = emptyList()
            Log.d(TAG, "recovery → YouTube native queue ${list.size}, index $ytQIndex @${pos}ms")
            playCurrentYt(pos) // re-resolves a fresh audio URL on the device IP
            return
        }
        if (kind == "musicbank") {
            val arr = o.optJSONArray("tracks") ?: return
            val list = ArrayList<MusicBank.Track>(arr.length())
            for (i in 0 until arr.length()) {
                val t = arr.optJSONObject(i) ?: continue
                val id = t.optString("id", ""); if (id.isBlank()) continue
                list.add(MusicBank.Track(id, t.optString("title", id), t.optString("genre", "")))
            }
            if (list.isEmpty()) return
            queue = list
            queueGenre = o.optString("genre", "")
            queueIndex = o.optInt("index", 0).coerceIn(0, list.size - 1)
            currentKind = "musicbank"
            Log.d(TAG, "recovery → Music Bank queue ${list.size}, index $queueIndex @${pos}ms")
            playCurrentTrack(pos) // re-authorizes a fresh media token
        } else {
            val url = o.optString("url", ""); if (url.isBlank()) return
            currentKind = "stream"; queue = emptyList()
            Log.d(TAG, "recovery → resume stream ${o.optString("title", "")} @${pos}ms")
            player?.play(url, o.optString("title", ""), pos)
        }
    }

    private fun goForeground(playing: Boolean) {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0),
        )
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("VONO Streamer")
            .setContentText(if (playing) "Playing" else "Running (infrastructure)")
            .setContentIntent(open)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        // Type must match reality: mediaPlayback while it owns audio, else specialUse.
        val type = when {
            playing && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE -> ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            else -> 0
        }
        ServiceCompat.startForeground(this, NOTIF_ID, notif, type)
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "VONO Streamer", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Keeps the VONO Streamer appliance connected and playing."
                    setShowBadge(false)
                },
            )
        }
    }

    companion object {
        private const val TAG = "VonoStreamer"
        private const val CHANNEL_ID = "vono_streamer_service"
        private const val NOTIF_ID = 4301
        const val ACTION_PLAY_TEST = "com.vono.streamer.PLAY_TEST"
        const val ACTION_PLAY_MUSICBANK = "com.vono.streamer.PLAY_MUSICBANK"
        const val ACTION_NEXT = "com.vono.streamer.NEXT"
        const val ACTION_PREV = "com.vono.streamer.PREV"
        const val ACTION_STOP = "com.vono.streamer.STOP"
        // 2A-1 engine test: a stable public MP3 radio stream (tokenless). Music Bank/R2 = 2A-2.
        const val TEST_STREAM_URL = "https://ice1.somafm.com/groovesalad-128-mp3"
        // Boot/network recovery backoff bounds (native sources only).
        private const val RECOVERY_MIN_DELAY = 2000L
        private const val RECOVERY_MAX_DELAY = 30000L
        // Jingle ducking: main music continues at 30% under a PLAY_INTERRUPT.
        private const val DUCK_FACTOR = 0.3f
        private const val JINGLE_MAX_MS = 60000L
        // POC (2A-4): route YouTube PLAY_SOURCE to the on-device NewPipe→ExoPlayer engine
        // instead of the WebView. The WebView fallback code stays intact but unused while true.
        const val POC_NATIVE_YOUTUBE = true
        const val ACTION_PLAY_YT_POC = "com.vono.streamer.PLAY_YT_POC" // Settings test button
        // A real music video + a playlist for the isolated POC test buttons.
        const val POC_YT_TEST_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        // A/B crossfade default (desktop parity). No local mix-duration setting yet → 6s.
        private const val DEFAULT_CROSSFADE_SEC = 6

        fun start(context: Context) {
            val i = Intent(context, VonoStreamerService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i)
            else context.startService(i)
        }

        fun send(context: Context, action: String) {
            val i = Intent(context, VonoStreamerService::class.java).setAction(action)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i)
            else context.startService(i)
        }
    }
}
