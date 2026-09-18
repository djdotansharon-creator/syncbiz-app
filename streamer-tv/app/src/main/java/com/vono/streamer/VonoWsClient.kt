package com.vono.streamer

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.random.Random

/**
 * Native VONO WebSocket client (Phase 1, shadow). Connects with the EXISTING protocol,
 * REGISTERs as a controller/observer (never MASTER), answers the server heartbeat
 * (OkHttp auto-pongs; we also send client pings), and reconnects with bounded backoff.
 * It receives (and, in shadow mode, only logs) COMMAND/STATE_UPDATE — it never executes
 * playback and never claims MASTER.
 */
class VonoWsClient(
    private val auth: AuthProvider,
    private val deviceIdProvider: () -> String,
    private val onCommand: (command: String, payload: JSONObject?) -> Unit = { _, _ -> },
    private val onMode: (mode: String) -> Unit = {},
) {
    private val http = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)   // keep-warm + drop detection
        .connectTimeout(15, TimeUnit.SECONDS)
        .build()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var webSocket: WebSocket? = null
    @Volatile private var intentionalClose = false
    @Volatile private var connecting = false
    @Volatile private var attempt = 0

    fun start() {
        intentionalClose = false
        connect()
    }

    /** Trigger an immediate reconnect (e.g. network returned). */
    fun kick() {
        if (intentionalClose) return
        if (webSocket == null && !connecting) connect()
    }

    /** Re-claim MASTER (appliance priority) after being bumped to CONTROL. */
    fun claimMaster() { webSocket?.send(VonoProtocol.buildSetMaster()) }

    /** Publish the current playback state to CONTROL. Thread-safe (OkHttp send). */
    fun sendStateUpdate(state: JSONObject) {
        try { webSocket?.send(VonoProtocol.buildStateUpdate(state)) } catch (_: Exception) {}
    }

    fun stop() {
        intentionalClose = true
        try { webSocket?.close(1000, "service stopping") } catch (_: Exception) {}
        webSocket = null
        scope.cancel()
    }

    private fun setConn(c: AppState.Conn, err: String? = null) {
        AppState.conn = c
        if (err != null) AppState.lastError = err
        AppState.reconnectAttempt = attempt
        AppState.notifyChanged()
    }

    private fun connect() {
        if (connecting || intentionalClose) return
        connecting = true
        setConn(if (attempt == 0) AppState.Conn.CONNECTING else AppState.Conn.RECONNECTING)
        scope.launch {
            val token = auth.fetchWsToken()
            if (token == null) {
                connecting = false
                setConn(AppState.Conn.OFFLINE, "no session token (log in once in the UI)")
                scheduleReconnect()
                return@launch
            }
            val req = Request.Builder().url(VonoProtocol.WS_URL).build()
            webSocket = http.newWebSocket(req, listener(token))
        }
    }

    private fun listener(token: String) = object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
            connecting = false
            AppState.lastConnectedAt = System.currentTimeMillis()
            setConn(AppState.Conn.CONNECTED)
            val register = VonoProtocol.buildRegister(token, deviceIdProvider())
            ws.send(register)
            Log.d("VonoStreamer", "WS open → REGISTER (shadow=${VonoProtocol.SHADOW_MODE})")
        }

        override fun onMessage(ws: WebSocket, text: String) {
            AppState.lastServerMsgAt = System.currentTimeMillis()
            when (VonoProtocol.messageType(text)) {
                "REGISTERED" -> {
                    attempt = 0
                    setConn(AppState.Conn.REGISTERED)
                    if (!VonoProtocol.SHADOW_MODE) {
                        ws.send(VonoProtocol.buildSetMaster()) // claim MASTER (appliance is the player)
                        Log.d("VonoStreamer", "REGISTERED → claim MASTER")
                    } else {
                        Log.d("VonoStreamer", "REGISTERED (shadow observer)")
                    }
                }
                "SET_DEVICE_MODE" -> {
                    val mode = try { JSONObject(text).optString("mode", "") } catch (_: Exception) { "" }
                    if (mode.isNotBlank()) {
                        AppState.deviceMode = mode; AppState.notifyChanged()
                        onMode(mode)
                    }
                }
                "COMMAND" -> {
                    try {
                        val o = JSONObject(text)
                        val command = o.optString("command", "")
                        val payload = o.optJSONObject("payload")
                        if (command.isNotBlank()) onCommand(command, payload)
                    } catch (e: Exception) { Log.w("VonoStreamer", "bad COMMAND: ${e.message}") }
                }
            }
        }

        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
            Log.d("VonoStreamer", "WS closing $code $reason")
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            webSocket = null
            connecting = false
            if (!intentionalClose) { setConn(AppState.Conn.RECONNECTING); scheduleReconnect() }
            else setConn(AppState.Conn.OFFLINE)
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            webSocket = null
            connecting = false
            Log.w("VonoStreamer", "WS failure: ${t.message}")
            if (!intentionalClose) { setConn(AppState.Conn.RECONNECTING, t.message); scheduleReconnect() }
        }
    }

    private fun scheduleReconnect() {
        if (intentionalClose) return
        attempt += 1
        val base = min(1000L * (1L shl min(attempt, 5)), 30_000L) // 2,4,8,16,32→cap 30s
        val jitter = (base * (Random.nextDouble(-0.2, 0.2))).toLong()
        val delayMs = (base + jitter).coerceAtLeast(1000L)
        AppState.reconnectAttempt = attempt
        AppState.notifyChanged()
        scope.launch {
            delay(delayMs)
            if (!intentionalClose && webSocket == null) connect()
        }
    }
}
