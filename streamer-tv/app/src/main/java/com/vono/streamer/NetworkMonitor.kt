package com.vono.streamer

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log

/**
 * Watches connectivity so the WS client reconnects the instant the network returns
 * (rather than only on backoff). Purely a trigger — reconnect/backoff lives in the
 * WS client.
 */
class NetworkMonitor(
    private val context: Context,
    private val onAvailable: () -> Unit,
    private val onLost: () -> Unit,
) {
    private var cm: ConnectivityManager? = null
    private var callback: ConnectivityManager.NetworkCallback? = null

    fun start() {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        cm = manager
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                AppState.hasNetwork = true
                AppState.notifyChanged()
                Log.d("VonoStreamer", "network available")
                onAvailable()
            }
            override fun onLost(network: Network) {
                AppState.hasNetwork = false
                AppState.notifyChanged()
                Log.d("VonoStreamer", "network lost")
                onLost()
            }
        }
        callback = cb
        val req = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        try { manager.registerNetworkCallback(req, cb) } catch (e: Exception) {
            Log.w("VonoStreamer", "registerNetworkCallback failed: ${e.message}")
        }
    }

    fun stop() {
        val c = callback ?: return
        try { cm?.unregisterNetworkCallback(c) } catch (_: Exception) {}
        callback = null
    }
}
