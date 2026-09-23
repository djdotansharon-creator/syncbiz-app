package com.vono.streamer

import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import java.util.concurrent.TimeUnit

/**
 * NewPipeExtractor Downloader backed by OkHttp. NewPipe uses this for all its HTTP calls
 * (InnerTube API + the player JS it runs in its bundled JS sandbox). Runs entirely on the
 * DEVICE, so every resolved media URL is signed to the GOtv's own IP (no cross-IP 403).
 */
class NewPipeOkHttpDownloader(base: OkHttpClient) : Downloader() {
    private val client: OkHttpClient = base.newBuilder()
        .readTimeout(30, TimeUnit.SECONDS)
        .connectTimeout(20, TimeUnit.SECONDS)
        .build()

    override fun execute(request: Request): Response {
        val builder = okhttp3.Request.Builder().url(request.url())
        for ((name, values) in request.headers()) {
            builder.removeHeader(name)
            for (value in values) builder.addHeader(name, value)
        }
        if (request.headers()["User-Agent"].isNullOrEmpty()) {
            builder.header("User-Agent", USER_AGENT)
        }
        val data = request.dataToSend()
        val body = if (data != null) data.toRequestBody(null, 0, data.size) else null
        builder.method(request.httpMethod(), body)

        client.newCall(builder.build()).execute().use { resp ->
            val bodyStr = resp.body?.string()
            return Response(
                resp.code,
                resp.message,
                resp.headers.toMultimap(),
                bodyStr,
                resp.request.url.toString(),
            )
        }
    }

    companion object {
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
}
