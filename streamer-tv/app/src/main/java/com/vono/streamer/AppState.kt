package com.vono.streamer

/**
 * Observable snapshot of the native appliance core, for the diagnostics screen.
 * Deliberately tiny + thread-safe; no cloud logic here.
 */
object AppState {
    enum class Conn { OFFLINE, CONNECTING, CONNECTED, REGISTERED, RECONNECTING }

    @Volatile var conn: Conn = Conn.OFFLINE
    @Volatile var shadow: Boolean = VonoProtocol.SHADOW_MODE
    @Volatile var deviceId: String = "—"
    @Volatile var lastConnectedAt: Long = 0L
    @Volatile var lastServerMsgAt: Long = 0L
    @Volatile var lastError: String = ""
    @Volatile var reconnectAttempt: Int = 0
    @Volatile var hasNetwork: Boolean = false
    @Volatile var deviceMode: String = "—" // MASTER / CONTROL

    // Native playback (Phase 2A)
    @Volatile var playing: Boolean = false
    @Volatile var playingTitle: String = ""
    @Volatile var positionMs: Long = 0L
    @Volatile var durationMs: Long = 0L
    @Volatile var volumePct: Int = 100

    private val listeners = mutableListOf<() -> Unit>()

    @Synchronized fun addListener(l: () -> Unit) { listeners.add(l) }
    @Synchronized fun removeListener(l: () -> Unit) { listeners.remove(l) }

    fun notifyChanged() {
        val snapshot = synchronized(this) { listeners.toList() }
        snapshot.forEach { runCatching { it() } }
    }
}
