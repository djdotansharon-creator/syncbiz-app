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
    private var player: NativePlayer? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())

    @Volatile private var deviceId = "vono-streamer"

    private lateinit var musicBank: MusicBank
    @Volatile private var queue: List<MusicBank.Track> = emptyList()
    @Volatile private var queueIndex = 0
    @Volatile private var queueGenre: String? = null
    @Volatile private var mediaToken: String? = null
    @Volatile private var mediaTokenExpSec: Long = 0
    @Volatile private var currentKind: String = "stream" // "stream" | "musicbank"
    private var jingleMp: android.media.MediaPlayer? = null
    private val reclaimTimes = ArrayDeque<Long>() // MASTER reclaim rate-limit

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
        netMonitor = NetworkMonitor(this, onAvailable = { ws.kick() }, onLost = {})
        netMonitor?.start()

        // Native audio engine (created on the main thread). Auto-advances the queue on track end.
        player = NativePlayer(this, onChanged = { onPlaybackChanged() }, onEnded = { advanceQueue() })

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
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_TEST -> main.post {
                currentKind = "stream"; queue = emptyList()
                player?.play(TEST_STREAM_URL, "Native engine test stream")
            }
            ACTION_PLAY_MUSICBANK -> playMusicBankTest()
            ACTION_NEXT -> main.post { queueNext() }
            ACTION_PREV -> main.post { queuePrev() }
            ACTION_STOP -> main.post { currentKind = "stream"; queue = emptyList(); player?.stop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "service onDestroy")
        main.removeCallbacksAndMessages(null)
        netMonitor?.stop()
        if (this::ws.isInitialized) ws.stop()
        main.post { jingleMp?.release(); jingleMp = null; player?.release() }
        scope.cancel()
        super.onDestroy()
    }

    private fun restore(json: String) {
        try {
            val o = JSONObject(json)
            val kind = o.optString("kind", "stream")
            val status = o.optString("status", "")
            val pos = o.optLong("positionMs", 0L)
            val vol = o.optInt("volumePct", 100)
            player?.setVolume(vol / 100f)
            if (status != "playing") return
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
                Log.d(TAG, "boot restore → Music Bank queue ${list.size}, index $queueIndex @${pos}ms")
                playCurrentTrack(pos) // re-authorizes + resumes
            } else {
                val url = o.optString("url", ""); val title = o.optString("title", "")
                if (url.isNotBlank()) {
                    currentKind = "stream"
                    Log.d(TAG, "boot restore → resume stream $title @${pos}ms")
                    player?.play(url, title, pos)
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "restore failed: ${e.message}")
        }
    }

    /** Called on the main thread by NativePlayer on every transition. */
    private fun onPlaybackChanged() {
        val p = player ?: return
        goForeground(playing = p.isPlaying() || p.currentUrl != null)
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
            } else {
                put("url", p.currentUrl ?: "")
                put("title", p.currentTitle)
            }
        }.toString()
        scope.launch { runCatching { store.writePlaybackState(snap) } }
        // Publish live playback state to CONTROL (phone/web mirror). Cutover only.
        if (!VonoProtocol.SHADOW_MODE && this::ws.isInitialized) {
            runCatching { ws.sendStateUpdate(buildState()) }
        }
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
            withContext(Dispatchers.Main) { player?.play(url, t.title, positionMs) }
        }
    }

    private fun advanceQueue() {
        if (currentKind != "musicbank") return
        if (queueIndex < queue.size - 1) { queueIndex++; playCurrentTrack() }
    }
    private fun queueNext() { if (currentKind == "musicbank" && queueIndex < queue.size - 1) { queueIndex++; playCurrentTrack() } }
    private fun queuePrev() { if (currentKind == "musicbank" && queueIndex > 0) { queueIndex--; playCurrentTrack() } }

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
            when (command) {
                "PLAY" -> player?.resume()
                "PAUSE" -> player?.pause()
                "STOP" -> { currentKind = "stream"; queue = emptyList(); player?.stop() }
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
        when {
            low.contains("youtube.com") || low.contains("youtu.be") || type.contains("youtube") ->
                reportUnsupported(id, title, "YouTube is not supported on the streamer appliance")
            low.contains("/api/media/") -> playMusicBankUrl(url, title) // R2 (needs token)
            url.startsWith("http") -> { currentKind = "stream"; queue = emptyList(); player?.play(url, title) } // direct audio / radio
            else -> reportUnsupported(id, title, "Unsupported source type ($type/$origin) on the streamer")
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
            withContext(Dispatchers.Main) { currentKind = "stream"; queue = emptyList(); player?.play(full, title) }
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
        }
    }

    /** On-Air jingle: duck the main player, play the jingle once, restore. */
    private fun playJingle(payload: JSONObject?) {
        val raw = payload?.optString("url", "") ?: return
        if (raw.isBlank()) return
        val abs = if (raw.startsWith("/")) VonoProtocol.APP_ORIGIN + raw else raw
        main.post {
            val prevVol = player?.volume() ?: 1f
            player?.setVolume(prevVol * 0.15f)
            jingleMp?.release(); jingleMp = null
            val mp = android.media.MediaPlayer()
            jingleMp = mp
            try {
                mp.setAudioAttributes(
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC).build(),
                )
                mp.setDataSource(abs)
                mp.setOnCompletionListener { player?.setVolume(prevVol); it.release(); if (jingleMp === it) jingleMp = null }
                mp.setOnErrorListener { m, _, _ -> player?.setVolume(prevVol); m.release(); if (jingleMp === m) jingleMp = null; true }
                mp.setOnPreparedListener { it.start() }
                mp.prepareAsync()
            } catch (e: Exception) {
                player?.setVolume(prevVol); Log.w(TAG, "jingle failed: ${e.message}")
            }
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
