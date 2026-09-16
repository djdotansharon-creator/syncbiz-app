package com.vono.streamer

import android.content.Context

/** Small SharedPreferences wrapper for the shell's settings. */
object Prefs {
    private const val FILE = "vono_streamer_prefs"
    private const val KEY_START_ON_BOOT = "start_on_boot"
    private const val KEY_AUTO_RESUME = "auto_resume"
    private const val KEY_LAST_LOAD = "last_load_status"   // "ok" | "error" | "unknown"
    private const val KEY_LAST_LOAD_AT = "last_load_at"    // epoch millis

    private fun p(ctx: Context) = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun startOnBoot(ctx: Context): Boolean = p(ctx).getBoolean(KEY_START_ON_BOOT, false)
    fun setStartOnBoot(ctx: Context, v: Boolean) = p(ctx).edit().putBoolean(KEY_START_ON_BOOT, v).apply()

    // Auto-resume defaults ON — it simply lets the existing web engine's built-in
    // recovery run. OFF makes the shell clear the engine's recovery keys on exit.
    fun autoResume(ctx: Context): Boolean = p(ctx).getBoolean(KEY_AUTO_RESUME, true)
    fun setAutoResume(ctx: Context, v: Boolean) = p(ctx).edit().putBoolean(KEY_AUTO_RESUME, v).apply()

    fun setLastLoad(ctx: Context, status: String) =
        p(ctx).edit().putString(KEY_LAST_LOAD, status).putLong(KEY_LAST_LOAD_AT, System.currentTimeMillis()).apply()
    fun lastLoad(ctx: Context): String = p(ctx).getString(KEY_LAST_LOAD, "unknown") ?: "unknown"
    fun lastLoadAt(ctx: Context): Long = p(ctx).getLong(KEY_LAST_LOAD_AT, 0L)
}
