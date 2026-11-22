package com.tea.a2share.net

import com.tea.a2share.core.ApiError
import org.json.JSONObject

/** 一次 HTTP 调用的结果。 */
data class HttpResponse(val code: Int, val body: String) {

    val isSuccess: Boolean get() = code in 200..299

    fun json(): JSONObject? = try {
        JSONObject(body)
    } catch (_: Exception) {
        null
    }

    /** 统一错误信封（PROTOCOL.md §1.3）。 */
    fun error(): ApiError? {
        val obj = json() ?: return null
        val error = obj.optJSONObject("error") ?: return null
        return ApiError.fromJson(error)
    }
}

/** 业务异常：带上协议错误码，调用方按 code 决策（不按 HTTP 状态猜）。 */
class ApiException(val error: ApiError) : Exception("${error.code}: ${error.message}")

/** 网络层接口（便于单测替身）。 */
interface HttpTransport {
    fun get(path: String, token: String?, connectTimeoutMs: Int, readTimeoutMs: Int): HttpResponse

    fun postJson(
        path: String,
        body: JSONObject,
        token: String?,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): HttpResponse

    fun putBytes(
        path: String,
        bytes: ByteArray,
        token: String,
        connectTimeoutMs: Int,
        readTimeoutMs: Int,
    ): HttpResponse

    fun delete(path: String, token: String, connectTimeoutMs: Int, readTimeoutMs: Int): HttpResponse
}
