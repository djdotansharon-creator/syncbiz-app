package com.vono.streamer

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.first
import java.util.UUID

/**
 * DataStore-backed persistent infrastructure (Phase 1):
 *  - stable native device identity (survives reboots/relaunch),
 *  - playback-recovery blob (written empty in Phase 1; Phase 2 audio resumes from it).
 * No cloud logic — just durable local state.
 */
private val Context.vonoDataStore by preferencesDataStore(name = "vono_streamer")

class VonoStore(private val context: Context) {
    private val keyDeviceId = stringPreferencesKey("device_id")
    private val keyPlaybackState = stringPreferencesKey("playback_state")

    /** Returns the persistent device id, minting + storing one on first run. */
    suspend fun getOrCreateDeviceId(): String {
        val existing = context.vonoDataStore.data.first()[keyDeviceId]
        if (!existing.isNullOrBlank()) return existing
        val id = "vono-streamer-" + UUID.randomUUID().toString()
        context.vonoDataStore.edit { it[keyDeviceId] = id }
        return id
    }

    /** Phase 2 will read/write the recovered queue/track/position here. */
    suspend fun readPlaybackState(): String? = context.vonoDataStore.data.first()[keyPlaybackState]

    suspend fun writePlaybackState(json: String) {
        context.vonoDataStore.edit { it[keyPlaybackState] = json }
    }
}
