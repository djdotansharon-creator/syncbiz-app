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

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "service onCreate")
        createChannel()
        goForeground(playing = false)

        store = VonoStore(this)
        auth = AuthProvider()
        ws = VonoWsClient(auth) { deviceId }
        netMonitor = NetworkMonitor(this, onAvailable = { ws.kick() }, onLost = {})
        netMonitor?.start()

        // Native audio engine (created on the main thread).
        player = NativePlayer(this) { onPlaybackChanged() }

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
                player?.play(TEST_STREAM_URL, "Native engine test stream")
            }
            ACTION_STOP -> main.post { player?.stop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        Log.d(TAG, "service onDestroy")
        main.removeCallbacksAndMessages(null)
        netMonitor?.stop()
        if (this::ws.isInitialized) ws.stop()
        main.post { player?.release() }
        scope.cancel()
        super.onDestroy()
    }

    private fun restore(json: String) {
        try {
            val o = JSONObject(json)
            val url = o.optString("url", "")
            val status = o.optString("status", "")
            val title = o.optString("title", "")
            val pos = o.optLong("positionMs", 0L)
            val vol = o.optInt("volumePct", 100)
            player?.setVolume(vol / 100f)
            if (url.isNotBlank() && status == "playing") {
                Log.d(TAG, "boot restore → resume $title @${pos}ms")
                player?.play(url, title, pos)
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
            put("url", p.currentUrl ?: "")
            put("title", p.currentTitle)
            put("positionMs", p.positionMs())
            put("volumePct", (p.volume() * 100).toInt())
            put("status", if (p.isPlaying()) "playing" else "paused")
            put("updatedAt", System.currentTimeMillis())
        }.toString()
        scope.launch { runCatching { store.writePlaybackState(snap) } }
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
