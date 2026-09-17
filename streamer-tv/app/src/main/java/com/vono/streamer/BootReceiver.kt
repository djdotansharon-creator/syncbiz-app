package com.vono.streamer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Optional "Start VONO when device starts".
 *
 * A bare startActivity() from BOOT_COMPLETED is blocked on Android 12+/14 by the
 * background-activity-launch (BAL) policy on most TV OEMs — that is why the old
 * version didn't come up. The reliable non-privileged technique is a high-importance
 * notification carrying a FULL-SCREEN INTENT (the same mechanism alarm/call apps use
 * to bring a full-screen UI to the front from the background). We fire that AND still
 * try a direct launch as a fallback for OEMs that allow it.
 *
 * Still best-effort: it is NOT device-owner / kiosk. On some devices the user must
 * allow "full screen notifications" (and notifications) for VONO Streamer once. If the
 * OS blocks it entirely, one manual launch is enough — the web player then auto-resumes
 * (autoresume=1) and keeps playing. See README "Start on boot — limitations".
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON"
        ) return

        if (!Prefs.startOnBoot(context)) return

        val launch = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }

        // Primary path: full-screen-intent notification (bypasses BAL where allowed).
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "VONO Streamer startup",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Brings VONO Streamer to the screen when the device starts."
                    setShowBadge(false)
                }
                nm.createNotificationChannel(channel)
            }
            val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
            val fullScreenPi = PendingIntent.getActivity(context, 0, launch, piFlags)
            val notif = Notification.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("VONO Streamer")
                .setContentText("Starting…")
                .setContentIntent(fullScreenPi)
                .setFullScreenIntent(fullScreenPi, true)
                .setAutoCancel(true)
                .setOngoing(false)
                .build()
            nm.notify(NOTIF_ID, notif)
        } catch (e: Exception) {
            Log.w(TAG, "full-screen-intent start-on-boot failed: ${e.message}")
        }

        // Fallback: direct launch (works on some OEMs / older TVs; blocked by BAL on others).
        try {
            context.startActivity(launch)
        } catch (e: Exception) {
            Log.w(TAG, "direct start-on-boot launch blocked: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "VonoStreamer"
        private const val CHANNEL_ID = "vono_streamer_boot"
        private const val NOTIF_ID = 4201
    }
}
