package com.vono.streamer

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Bundle
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

        findViewById<TextView>(R.id.text_connection).text = connectionStatus()
        findViewById<TextView>(R.id.text_version).text =
            getString(R.string.app_version_fmt, BuildConfig.VERSION_NAME)
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
