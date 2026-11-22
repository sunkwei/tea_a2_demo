package com.tea.a2share.net

import android.os.Build
import com.tea.a2share.BuildConfig
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * `HttpURLConnection` 实现的传输层（DESIGN.md §3.2）。
 *
 * 明文 HTTP、无 TLS：只走局域网（需求 §1.3.2）。
 * 每个请求独立连接与超时，失败即抛异常，由上层决定重试与退避。
 */
class HttpUrlTransport(
    private val baseUrlProvider: () -> String,
    private val deviceId: String,
) : HttpTransport {

    override fun get(path: String, token: String?, connectTimeoutMs: Int, readTimeoutMs: Int): HttpResponse =
        request("GET", path, null, token, connectTimeoutMs, readTimeoutMs)

    override fun postJson(
        path: String,
        body: JSONObject,
        token: String?,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): HttpResponse = request("POST", path, body, token, connectTimeoutMs, readTimeoutMs)

    override fun putBytes(
        path: String,
        bytes: ByteArray,
        token: String,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): HttpResponse = request("PUT", path, bytes, token, connectTimeoutMs, readTimeoutMs)

    override fun delete(path: String, token: String, connectTimeoutMs: Int, readTimeoutMs: Int): HttpResponse =
        request("DELETE", path, null, token, connectTimeoutMs, readTimeoutMs)

    private fun request(
        method: String,
        path: String,
        body: Any?,
        token: String?,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): HttpResponse {
        val base = baseUrlProvider().trimEnd('/')
        val url = URL("$base$path")
        val connection = url.openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.useCaches = false
            connection.setRequestProperty("X-A2-Device", deviceId)
            connection.setRequestProperty("X-A2-Request", UUID.randomUUID().toString().take(8))
            connection.setRequestProperty("User-Agent", "a2share-android/${BuildConfig.VERSION_NAME}")
            if (!token.isNullOrEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer $token")
            }
            if (body is JSONObject) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                val payload = body.toString().toByteArray(Charsets.UTF_8)
                connection.setFixedLengthStreamingMode(payload.size)
                connection.outputStream.use { it.write(payload) }
            } else if (body is ByteArray) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/octet-stream")
                connection.setFixedLengthStreamingMode(body.size)
                connection.outputStream.use { it.write(body) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return HttpResponse(code, text)
        } catch (e: IOException) {
            throw IOException(e.message ?: "网络错误", e)
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        /** Android 9+ 默认禁止明文 HTTP，manifest 里已放行；这里再确认一次运行环境。 */
        val supportsCleartext: Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    }
}
