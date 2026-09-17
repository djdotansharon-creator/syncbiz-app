package com.vono.streamer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * VonoStreamerService — the native appliance CORE (Phase 1, shadow/infrastructure mode).
 *
 * Foreground service that lives OUTSIDE the Activity/WebView: persistent device identity,
 * native auth (reuses the WebView session cookie → ws-token), native WS connection with
 * heartbeat + bounded-backoff reconnect, and ConnectivityManager network recovery. It
 * boots via BootReceiver and survives HOME/BACK/other apps.
 *
 * Phase 1 does NOT play audio and does NOT become MASTER (registers as a controller/
 * observer). The existing WebView streamer remains the real branch_streamer_station MASTER.
 */
class VonoStreamerService : Service() {

    private lateinit var store: VonoStore
    private lateinit var auth: AuthProvider
    private lateinit var ws: VonoWsClient
    private var netMonitor: NetworkMonitor? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var deviceId = "vono-streamer"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "service onCreate")
        createChannel()
        goForeground()

        store = VonoStore(this)
        auth = AuthProvider()
        ws = VonoWsClient(auth) { deviceId }
        netMonitor = NetworkMonitor(this, onAvailable = { ws.kick() }, onLost = { /* WS onFailure handles it */ })
        netMonitor?.start()

        scope.launch {
            deviceId = runCatching { store.getOrCreateDeviceId() }.getOrDefault(deviceId)
            AppState.deviceId = deviceId
            AppState.notifyChanged()
            ws.start()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        Log.d(TAG, "service onDestroy")
        netMonitor?.stop()
        if (this::ws.isInitialized) ws.stop()
        scope.cancel()
        super.onDestroy()
    }

    private fun goForeground() {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0),
        )
        val notif = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("VONO Streamer")
            .setContentText(if (VonoProtocol.SHADOW_MODE) "Running (infrastructure)" else "Playing")
            .setContentIntent(open)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        // Phase 1 = specialUse (persistent connectivity, NO audio). The FGS type must match
        // the real use case on Android 14; mediaPlayback is introduced only in Phase 2.
        val fgsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIF_ID, notif, fgsType)
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "VONO Streamer", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Keeps the VONO Streamer appliance connected."
                    setShowBadge(false)
                },
            )
        }
    }

    companion object {
        private const val TAG = "VonoStreamer"
        private const val CHANNEL_ID = "vono_streamer_service"
        private const val NOTIF_ID = 4301

        fun start(context: Context) {
            val i = Intent(context, VonoStreamerService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(i)
            else context.startService(i)
        }
    }
}
