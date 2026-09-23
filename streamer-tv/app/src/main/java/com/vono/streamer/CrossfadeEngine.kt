package com.vono.streamer

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * Two-deck (A/B) crossfade engine over Media3/ExoPlayer. Ports the desktop
 * playback-orchestrator crossfade contract:
 *   - the incoming track loads on the STANDBY deck at volume 0;
 *   - the dual ramp begins ONLY once the incoming deck is really playing;
 *   - outgoing and incoming OVERLAP (true crossfade, never fade→silence→replace);
 *   - a failed/slow incoming NEVER kills the current track (abort, keep outgoing);
 *   - default crossfade 6s (configurable via setCrossfadeSec);
 *   - duck-aware: every ramp targets master*duck, so both decks stay within the duck envelope.
 *
 * Drop-in for the old single-deck NativePlayer (same public surface) + crossfadeTo/setDuck.
 * Created and called on the MAIN thread only.
 *
 * `currentUrl`/`currentTitle` and position/duration/status report the CURRENT ATTEMPT deck
 * (the incoming deck during a crossfade) so CONTROL sees the new track immediately; a failed
 * incoming reverts the attempt to the still-playing outgoing.
 */
class CrossfadeEngine(
    context: Context,
    private val onChanged: () -> Unit,
    private val onEnded: () -> Unit = {},
    private val onError: () -> Unit = {},
) {
    private val main = Handler(Looper.getMainLooper())
    private val decks = arrayOf(buildDeck(context), buildDeck(context))
    private var activeIdx = 0            // deck that owns the CURRENT (outgoing) audio
    private var attemptIdx = 0           // deck reported to CONTROL (incoming during a crossfade)

    // ── Single audio-focus owner for the whole music engine ───────────────────────
    private val audioManager = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focusRequest: android.media.AudioFocusRequest? = null
    private var hasFocus = false
    private var pausedByFocusLoss = false
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        when (change) {
            AudioManager.AUDIOFOCUS_LOSS -> { pausedByFocusLoss = false; pause() }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> { if (isPlaying()) { pausedByFocusLoss = true; pause() } }
            AudioManager.AUDIOFOCUS_GAIN -> { if (pausedByFocusLoss) { pausedByFocusLoss = false; resume() } }
        }
    }
    /** Request AUDIOFOCUS_GAIN once for the engine (idempotent). Both decks are focus-agnostic. */
    private fun ensureFocus() {
        if (hasFocus) return
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val attrs = android.media.AudioAttributes.Builder()
                .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC).build()
            val req = android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(attrs)
                .setWillPauseWhenDucked(false)
                .setOnAudioFocusChangeListener(focusListener)
                .build()
            focusRequest = req
            audioManager.requestAudioFocus(req)
        } else {
            @Suppress("DEPRECATION")
            audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
        hasFocus = granted == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
    private fun abandonFocus() {
        if (!hasFocus) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        } else {
            @Suppress("DEPRECATION") audioManager.abandonAudioFocus(focusListener)
        }
        hasFocus = false
        pausedByFocusLoss = false
    }

    @Volatile var currentUrl: String? = null
        private set
    @Volatile var currentTitle: String = ""
        private set

    private var masterVol = 1f
    private var duckFactor = 1f
    private var crossfadeSec = 6

    // Crossfade in-flight state.
    private var xfadeIncomingIdx = -1
    private var xfadeSawPlaying = false
    private var rampRunnable: Runnable? = null
    private var timeoutRunnable: Runnable? = null
    private var rampStartMs = 0L

    private fun effective(): Float = (masterVol * duckFactor).coerceIn(0f, 1f)
    private fun ramping(): Boolean = rampRunnable != null

    // Both decks are focus-AGNOSTIC (handleAudioFocus=false): the engine owns ONE audio-focus
    // request for the whole music engine, so A and B can overlap during a crossfade without
    // competing with each other for focus (deck-owned focus made the incoming deck's request
    // duck/pause the outgoing deck — breaking the overlap).
    private fun buildDeck(context: Context): ExoPlayer =
        ExoPlayer.Builder(context).build().apply {
            setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
                /* handleAudioFocus = */ false,
            )
            setHandleAudioBecomingNoisy(true)
        }

    init {
        for (i in decks.indices) {
            val idx = i
            decks[idx].addListener(object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    if (idx == xfadeIncomingIdx && isPlaying) onIncomingPlaying()
                    if (idx == attemptIdx) { publish(); onChanged() }
                }
                override fun onPlaybackStateChanged(state: Int) {
                    if (idx == attemptIdx) {
                        publish(); onChanged()
                        if (state == Player.STATE_ENDED) onEnded()
                    }
                }
                override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                    if (idx == attemptIdx) { publish(); onChanged() }
                }
                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    Log.w("VonoStreamer", "deck $idx error: ${error.errorCodeName}")
                    if (idx == xfadeIncomingIdx) {
                        // Incoming failed → keep the current (outgoing) track playing.
                        abortXfade("incoming_error")
                    } else if (idx == activeIdx) {
                        AppState.lastError = "playback: ${error.errorCodeName}"
                        AppState.notifyChanged()
                        currentUrl = null
                        onError()
                    }
                }
            })
        }
    }

    // ── Public surface (NativePlayer-compatible) ──────────────────────────────────
    fun setCrossfadeSec(sec: Int) { crossfadeSec = sec.coerceIn(0, 30) }

    /** Hard cut on the active deck (first track, boot restore, recovery). Cancels any crossfade. */
    fun play(url: String, title: String, positionMs: Long = 0L) {
        ensureFocus()
        cancelXfade(stopIncoming = true)
        currentUrl = url; currentTitle = title
        attemptIdx = activeIdx
        val d = decks[activeIdx]
        d.volume = effective()
        d.setMediaItem(MediaItem.fromUri(url))
        d.prepare()
        if (positionMs > 0) d.seekTo(positionMs)
        d.playWhenReady = true
        publish(); onChanged()
    }

    /**
     * True crossfade to a new track: load on the standby deck at vol 0, and once it is really
     * playing, ramp incoming up / outgoing down over the mix duration. If nothing is currently
     * playing, this is just a hard play(). If the incoming never starts, the current track is kept.
     */
    fun crossfadeTo(url: String, title: String, positionMs: Long = 0L) {
        ensureFocus()
        val activePlaying = decks[activeIdx].isPlaying || decks[activeIdx].playbackState == Player.STATE_BUFFERING
        if (!activePlaying || crossfadeSec <= 0) { play(url, title, positionMs); return }
        cancelXfade(stopIncoming = true) // supersede any in-flight crossfade; keep the active deck

        val incoming = 1 - activeIdx
        xfadeIncomingIdx = incoming
        xfadeSawPlaying = false
        // Report the incoming as the current attempt immediately (CONTROL shows the new track).
        attemptIdx = incoming
        currentUrl = url; currentTitle = title
        val d = decks[incoming]
        d.volume = 0f
        d.setMediaItem(MediaItem.fromUri(url))
        d.prepare()
        if (positionMs > 0) d.seekTo(positionMs)
        d.playWhenReady = true
        publish(); onChanged()

        // Abort if the incoming never reaches "playing".
        timeoutRunnable = Runnable {
            if (xfadeIncomingIdx == incoming && !xfadeSawPlaying) {
                Log.w("VonoStreamer", "crossfade incoming start timeout — keeping current")
                abortXfade("incoming_timeout")
            }
        }.also { main.postDelayed(it, XFADE_START_TIMEOUT_MS) }
    }

    private fun onIncomingPlaying() {
        if (xfadeSawPlaying) return
        xfadeSawPlaying = true
        timeoutRunnable?.let { main.removeCallbacks(it) }; timeoutRunnable = null
        beginRamp()
    }

    private fun beginRamp() {
        val incoming = xfadeIncomingIdx
        if (incoming < 0) return
        val outgoing = activeIdx
        rampStartMs = System.currentTimeMillis()
        val durMs = (crossfadeSec * 1000L).coerceAtLeast(1L)
        val tick = object : Runnable {
            override fun run() {
                if (xfadeIncomingIdx != incoming) return // superseded/aborted
                val t = ((System.currentTimeMillis() - rampStartMs).toFloat() / durMs).coerceIn(0f, 1f)
                val target = effective() // re-read each tick → duck changes during a crossfade apply to both decks
                decks[incoming].volume = target * t
                decks[outgoing].volume = target * (1f - t)
                if (t >= 1f) {
                    // Swap: incoming becomes the sole active deck; stop the outgoing.
                    decks[outgoing].playWhenReady = false
                    decks[outgoing].stop()
                    decks[outgoing].clearMediaItems()
                    activeIdx = incoming
                    attemptIdx = incoming
                    xfadeIncomingIdx = -1
                    rampRunnable = null
                    decks[incoming].volume = effective()
                    publish(); onChanged()
                } else {
                    main.postDelayed(this, RAMP_INTERVAL_MS)
                }
            }
        }
        rampRunnable = tick
        main.post(tick)
    }

    /** Abort an in-flight crossfade: drop the incoming deck, keep the outgoing (active) playing. */
    private fun abortXfade(reason: String) {
        Log.d("VonoStreamer", "abortXfade: $reason")
        val incoming = xfadeIncomingIdx
        cancelTimers()
        if (incoming >= 0) {
            decks[incoming].playWhenReady = false
            decks[incoming].stop()
            decks[incoming].clearMediaItems()
        }
        xfadeIncomingIdx = -1
        xfadeSawPlaying = false
        // Revert the reported attempt to the still-playing outgoing deck + restore its volume.
        attemptIdx = activeIdx
        decks[activeIdx].volume = effective()
        currentUrl = decks[activeIdx].currentMediaItem?.localConfiguration?.uri?.toString() ?: currentUrl
        publish(); onChanged()
    }

    private fun cancelTimers() {
        rampRunnable?.let { main.removeCallbacks(it) }; rampRunnable = null
        timeoutRunnable?.let { main.removeCallbacks(it) }; timeoutRunnable = null
    }

    /** Cancel any crossfade bookkeeping; optionally stop the incoming deck. Keeps the active deck. */
    private fun cancelXfade(stopIncoming: Boolean) {
        cancelTimers()
        val incoming = xfadeIncomingIdx
        if (stopIncoming && incoming >= 0) {
            decks[incoming].playWhenReady = false
            decks[incoming].stop()
            decks[incoming].clearMediaItems()
        }
        xfadeIncomingIdx = -1
        xfadeSawPlaying = false
        attemptIdx = activeIdx
    }

    fun resume() { ensureFocus(); decks[attemptIdx].playWhenReady = true }
    fun pause() { decks[activeIdx].playWhenReady = false; if (attemptIdx != activeIdx) decks[attemptIdx].playWhenReady = false }
    fun stop() {
        cancelXfade(stopIncoming = true)
        for (d in decks) { d.playWhenReady = false; d.stop(); d.clearMediaItems() }
        abandonFocus()
        currentUrl = null
        publish(); onChanged()
    }
    fun seekTo(ms: Long) { decks[attemptIdx].seekTo(ms); publish() }

    /** Master (fader) volume. Reported to CONTROL as-is so the fader never visibly drops during a duck. */
    fun setVolume(fraction: Float) {
        masterVol = fraction.coerceIn(0f, 1f)
        if (!ramping()) decks[attemptIdx].volume = effective()
        publish()
    }

    /** Duck/unduck for jingles: both decks ramp within master*factor. Restores master on unduck. */
    fun setDuck(active: Boolean, factor: Float) {
        duckFactor = if (active) factor.coerceIn(0f, 1f) else 1f
        if (!ramping()) decks[attemptIdx].volume = effective()
    }

    fun isCrossfading(): Boolean = xfadeIncomingIdx >= 0
    /** True while the current-attempt deck has a source loaded and is not idle (buffering/ready). */
    fun isActive(): Boolean = decks[attemptIdx].playbackState != Player.STATE_IDLE && decks[attemptIdx].currentMediaItem != null
    fun isPlaying(): Boolean = decks[attemptIdx].isPlaying
    fun positionMs(): Long = decks[attemptIdx].currentPosition.coerceAtLeast(0)
    fun durationMs(): Long = decks[attemptIdx].duration.let { if (it == C.TIME_UNSET) 0 else it }
    fun volume(): Float = masterVol

    fun release() { cancelTimers(); abandonFocus(); for (d in decks) d.release() }

    private fun publish() {
        val d = decks[attemptIdx]
        AppState.playing = d.isPlaying
        AppState.playingTitle = currentTitle
        AppState.positionMs = positionMs()
        AppState.durationMs = durationMs()
        AppState.volumePct = (masterVol * 100).toInt()
        AppState.notifyChanged()
    }

    companion object {
        private const val RAMP_INTERVAL_MS = 80L
        private const val XFADE_START_TIMEOUT_MS = 12000L
    }
}
