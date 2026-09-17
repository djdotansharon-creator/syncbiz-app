package com.vono.streamer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * On boot, start the native appliance SERVICE (not an Activity).
 *
 * This is the correct Android-14 fix: a BOOT_COMPLETED receiver may start a foreground
 * SERVICE (mediaPlayback), whereas starting an Activity from boot is blocked by the
 * background-activity-launch policy. The service connects to VONO Cloud with no UI open.
 *
 * Android 15+: starting a mediaPlayback FGS from BOOT_COMPLETED is further restricted —
 * guaranteed fleet boot needs Managed / Device-Owner / Dedicated-Device enrollment
 * (documented in the appliance design). This receiver stays best-effort on consumer 14/15.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_LOCKED_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON"
        ) return
        try {
            VonoStreamerService.start(context)
            Log.d("VonoStreamer", "boot → VonoStreamerService started")
        } catch (e: Exception) {
            Log.w("VonoStreamer", "boot service start failed: ${e.message}")
        }
    }
}
