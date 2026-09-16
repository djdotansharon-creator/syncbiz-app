package com.vono.streamer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Optional "Start VONO when device starts".
 *
 * Best-effort only. On Android 14 (and depending on the TV OEM) launching an
 * Activity from BOOT_COMPLETED is subject to background-activity-launch limits
 * and may be blocked or delayed. We do NOT use device-owner / kiosk / lock-task
 * yet, so this cannot be guaranteed on every device — it is a convenience.
 * See README "Start on boot — limitations".
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON"
        ) return

        if (!Prefs.startOnBoot(context)) return

        try {
            val launch = Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(launch)
        } catch (e: Exception) {
            // Blocked by the OS/OEM background-activity-launch policy — logged only.
            Log.w("VonoBootReceiver", "start-on-boot launch blocked: ${e.message}")
        }
    }
}
