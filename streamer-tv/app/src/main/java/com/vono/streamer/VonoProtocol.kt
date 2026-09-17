package com.vono.streamer

import org.json.JSONObject

/**
 * VONO WS wire protocol — mirrored EXACTLY from server/ws-remote-control-types.ts.
 * Phase 1 registers in SHADOW MODE as role="controller": the server never makes a
 * controller the branch MASTER and never routes branch PLAY/NEXT/JINGLE device
 * commands to it, so the native service proves connectivity WITHOUT participating in
 * MASTER election or stealing production commands. The existing WebView streamer stays
 * the real branch_streamer_station MASTER. Phase 2 cutover flips REGISTER_ROLE→"device"
 * + devicePurpose→"branch_streamer_station" (see buildRegister()).
 */
object VonoProtocol {
    // Endpoints (production). Mirror NEXT_PUBLIC_WS_URL + the hosted app origin.
    const val WS_URL = "wss://syncbiz-ws-production.up.railway.app"
    const val APP_ORIGIN = "https://syncbiz-app-production.up.railway.app"
    const val WS_TOKEN_URL = "$APP_ORIGIN/api/auth/ws-token"

    // Phase 1 = shadow observer. Do NOT change to "device" until native playback exists.
    const val SHADOW_MODE = true

    fun buildRegister(authToken: String, deviceId: String): String {
        val intent = JSONObject().apply {
            if (SHADOW_MODE) {
                // Controller/observer — cannot become MASTER.
                put("platform", "web")
                put("runtimeMode", "remote_control")
                put("devicePurpose", "branch_web_controller")
                put("leaseRoleHint", "none")
                put("contentScope", "branch")
            } else {
                // Phase 2 cutover — dedicated branch streamer MASTER.
                put("platform", "web")
                put("runtimeMode", "branch_playback")
                put("devicePurpose", "branch_streamer_station")
                put("leaseRoleHint", "MASTER")
                put("contentScope", "branch")
            }
        }
        return JSONObject().apply {
            put("type", "REGISTER")
            put("role", if (SHADOW_MODE) "controller" else "device")
            put("authToken", authToken)
            put("branchId", "default")
            put("registrationIntent", intent)
            // Controllers don't need a deviceId; a device (Phase 2) does. Harmless to include.
            if (!SHADOW_MODE) put("deviceId", deviceId)
        }.toString()
    }

    /** Server message type, or "" if unparseable. */
    fun messageType(text: String): String =
        try { JSONObject(text).optString("type", "") } catch (_: Exception) { "" }
}
