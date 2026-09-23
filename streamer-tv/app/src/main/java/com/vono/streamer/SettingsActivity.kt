package com.vono.streamer

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Button
import android.widget.Switch
import android.widget.TextView
import androidx.activity.ComponentActivity
import java.text.DateFormat
import java.util.Date

/**
 * Native VONO Streamer settings. Shell-level only — it never changes MASTER/CONTROL
 * or playback. Audio routing is DISPLAYED (not forced): Android/TV owns route
 * selection, so we list available outputs and open the OS Sound/Bluetooth settings.
 */
class SettingsActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        findViewById<Switch>(R.id.switch_start_on_boot).apply {
            isChecked = Prefs.startOnBoot(this@SettingsActivity)
            setOnCheckedChangeListener { _, v -> Prefs.setStartOnBoot(this@SettingsActivity, v) }
        }
        findViewById<Switch>(R.id.switch_auto_resume).apply {
            isChecked = Prefs.autoResume(this@SettingsActivity)
            setOnCheckedChangeListener { _, v -> Prefs.setAutoResume(this@SettingsActivity, v) }
        }

        findViewById<TextView>(R.id.text_audio_outputs).text = describeAudioOutputs()
        findViewById<Button>(R.id.btn_sound_settings).setOnClickListener { openSystemSetting(Settings.ACTION_SOUND_SETTINGS) }
        findViewById<Button>(R.id.btn_bluetooth_settings).setOnClickListener { openSystemSetting(Settings.ACTION_BLUETOOTH_SETTINGS) }

        findViewById<Button>(R.id.btn_test_native).setOnClickListener {
            VonoStreamerService.send(this, VonoStreamerService.ACTION_PLAY_TEST)
        }
        findViewById<Button>(R.id.btn_test_native_stop).setOnClickListener {
            VonoStreamerService.send(this, VonoStreamerService.ACTION_STOP)
        }
        findViewById<Button>(R.id.btn_test_musicbank).setOnClickListener {
            VonoStreamerService.send(this, VonoStreamerService.ACTION_PLAY_MUSICBANK)
        }
        findViewById<Button>(R.id.btn_test_youtube).setOnClickListener {
            VonoStreamerService.send(this, VonoStreamerService.ACTION_PLAY_YT_POC)
        }
        findViewById<Button>(R.id.btn_prev_track).setOnClickListener {
            VonoStreamerService.send(this, VonoStreamerService.ACTION_PREV)
        }
        findViewById<Button>(R.id.btn_next_track).setOnClickListener {
            VonoStreamerService.send(this, VonoStreamerService.ACTION_NEXT)
        }

        findViewById<TextView>(R.id.text_version).text =
            getString(R.string.app_version_fmt, BuildConfig.VERSION_NAME)
    }

    private val refresh = Handler(Looper.getMainLooper())
    private val refreshTick = object : Runnable {
        override fun run() {
            findViewById<TextView>(R.id.text_connection)?.text = connectionStatus() + "\n\n" + nativeStatus()
            refresh.postDelayed(this, 2000)
        }
    }

    override fun onResume() {
        super.onResume()
        refresh.post(refreshTick)
    }

    override fun onPause() {
        refresh.removeCallbacks(refreshTick)
        super.onPause()
    }

    private fun nativeStatus(): String {
        fun ago(ts: Long) = if (ts > 0) "${(System.currentTimeMillis() - ts) / 1000}s ago" else "—"
        val sb = StringBuilder()
        sb.append("VONO service (Phase 1 ").append(if (AppState.shadow) "shadow" else "master").append(")\n")
        sb.append("• Connection: ").append(AppState.conn.name).append('\n')
        sb.append("• Network: ").append(if (AppState.hasNetwork) "up" else "down").append('\n')
        sb.append("• Last server msg: ").append(ago(AppState.lastServerMsgAt)).append('\n')
        sb.append("• Connected: ").append(ago(AppState.lastConnectedAt)).append('\n')
        sb.append("• Reconnect attempt: ").append(AppState.reconnectAttempt).append('\n')
        sb.append("• Device id: ").append(AppState.deviceId).append('\n')
        sb.append("• Playback: ").append(if (AppState.playing) "playing — ${AppState.playingTitle}" else "stopped").append('\n')
        sb.append("• Position: ").append(AppState.positionMs / 1000).append("s / ").append(AppState.durationMs / 1000).append('s')
        if (AppState.lastError.isNotBlank()) sb.append("\n• Last error: ").append(AppState.lastError)
        return sb.toString()
    }

    private fun describeAudioOutputs(): String {
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val devices = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        if (devices.isEmpty()) return getString(R.string.audio_none)
        val labels = LinkedHashSet<String>()
        for (d in devices) labels.add(labelForType(d.type))
        return labels.joinToString("\n") { "• $it" }
    }

    private fun labelForType(type: Int): String = when (type) {
        AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC, AudioDeviceInfo.TYPE_HDMI_EARC -> "HDMI"
        AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER -> "Bluetooth audio"
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired headphones"
        AudioDeviceInfo.TYPE_AUX_LINE, AudioDeviceInfo.TYPE_LINE_ANALOG -> "Analog / line out"
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "Device speaker"
        AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET -> "USB audio"
        else -> "Other output"
    }

    private fun openSystemSetting(action: String) {
        try {
            startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            try { startActivity(Intent(Settings.ACTION_SETTINGS)) } catch (_: Exception) {}
        }
    }

    private fun connectionStatus(): String {
        val status = Prefs.lastLoad(this)
        val at = Prefs.lastLoadAt(this)
        val whenStr = if (at > 0) DateFormat.getDateTimeInstance().format(Date(at)) else "—"
        return getString(R.string.connection_fmt, status, whenStr)
    }
}
