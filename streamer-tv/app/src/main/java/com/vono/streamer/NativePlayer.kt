package com.vono.streamer

import android.content.Context
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * Phase 2A native audio engine (ExoPlayer). Plays a single directly-playable URL
 * (radio / direct HTTP in 2A-1; Music Bank/R2 via media-token in 2A-2). Runs inside
 * the foreground service, so audio continues when the Activity/WebView is gone
 * (HOME / Settings / another app). Must be created and called on ONE thread — the
 * service uses the main thread.
 *
 * onChanged() fires on every meaningful transition so the service can persist the
 * recovery snapshot (source/track/position/volume/status) to DataStore.
 */
class NativePlayer(
    context: Context,
    private val onChanged: () -> Unit,
) {
    private val exo: ExoPlayer = ExoPlayer.Builder(context).build().apply {
        setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build(),
            /* handleAudioFocus = */ true,
        )
        setHandleAudioBecomingNoisy(true)
        addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { publish(); onChanged() }
            override fun onPlaybackStateChanged(state: Int) { publish(); onChanged() }
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) { publish(); onChanged() }
            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                Log.w("VonoStreamer", "ExoPlayer error: ${error.errorCodeName}")
                AppState.lastError = "playback: ${error.errorCodeName}"
                AppState.notifyChanged()
            }
        })
    }

    @Volatile var currentUrl: String? = null
        private set
    @Volatile var currentTitle: String = ""
        private set

    fun play(url: String, title: String, positionMs: Long = 0L) {
        currentUrl = url
        currentTitle = title
        exo.setMediaItem(MediaItem.fromUri(url))
        exo.prepare()
        if (positionMs > 0) exo.seekTo(positionMs)
        exo.playWhenReady = true
        publish(); onChanged()
    }

    fun resume() { exo.playWhenReady = true }
    fun pause() { exo.playWhenReady = false }
    fun stop() { exo.stop(); currentUrl = null; publish(); onChanged() }
    fun seekTo(ms: Long) { exo.seekTo(ms); publish() }
    fun setVolume(fraction: Float) { exo.volume = fraction.coerceIn(0f, 1f); publish() }

    fun isPlaying(): Boolean = exo.isPlaying
    fun positionMs(): Long = exo.currentPosition.coerceAtLeast(0)
    fun durationMs(): Long = if (exo.duration == C.TIME_UNSET) 0 else exo.duration
    fun volume(): Float = exo.volume

    fun release() { exo.release() }

    private fun publish() {
        AppState.playing = exo.isPlaying
        AppState.playingTitle = currentTitle
        AppState.positionMs = positionMs()
        AppState.durationMs = durationMs()
        AppState.volumePct = (exo.volume * 100).toInt()
        AppState.notifyChanged()
    }
}
