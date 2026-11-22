package com.tea.a2share.net

import com.tea.a2share.core.ApiError
import com.tea.a2share.core.ClipboardResponse
import com.tea.a2share.core.DeviceInfo
import com.tea.a2share.core.HelloResponse
import com.tea.a2share.core.InitRequest
import com.tea.a2share.core.InitResponse
import com.tea.a2share.core.PairRequest
import com.tea.a2share.core.PairResponse
import com.tea.a2share.core.StatusResponse
import com.tea.a2share.core.UploadResult
import org.json.JSONObject
import java.io.IOException

/**
 * 业务级调用（PROTOCOL.md §4 的端点封装）。
 *
 * 超时按端点区分：探活 2 s、配对 5 s、PUT 5/60 s、finish 30 s。
 */
class PcClient(private val transport: HttpTransport) {

    /** 探活：成功返回 PC 信息，失败（连不上）返回 null——不算错误。 */
    fun hello(): HelloResponse? {
        val response = transport.get("/v1/hello", null, TIMEOUT_PROBE, TIMEOUT_PROBE)
        if (!response.isSuccess) return null
        val json = response.json() ?: return null
        return HelloResponse.fromJson(json)
    }

    /** 配对（二维码 secret 或 6 位短码）。失败抛 [ApiException]。 */
    fun pair(secret: String?, code: String?, device: DeviceInfo): PairResponse {
        val request = PairRequest(
            method = if (secret != null) "qr" else "code",
            secret = secret,
            code = code,
            device = device,
        )
        val response = transport.postJson("/v1/pair", request.toJson(), null, TIMEOUT_PAIR, TIMEOUT_PAIR)
        return parse(response) { PairResponse.fromJson(it) }
    }

    fun status(token: String): StatusResponse {
        val response = transport.get("/v1/status", token, TIMEOUT_PROBE, TIMEOUT_PROBE)
        return parse(response) { StatusResponse.fromJson(it) }
    }

    fun initUpload(request: InitRequest, token: String): InitResponse {
        val response = transport.postJson(
            "/v1/uploads", request.toJson(), token, TIMEOUT_PAIR, TIMEOUT_PAIR,
        )
        return parse(response) { InitResponse.fromJson(it) }
    }

    /** 上传一块，返回服务端已确认的字节数。 */
    fun putChunk(uploadId: String, offset: Long, bytes: ByteArray, token: String): Long {
        val response = transport.putBytes(
            "/v1/uploads/$uploadId?offset=$offset",
            bytes,
            token,
            TIMEOUT_CONNECT,
            TIMEOUT_BODY,
        )
        return parse(response) { it.optLong("received", offset + bytes.size) }
    }

    fun finish(uploadId: String, sha256: String?, token: String): UploadResult {
        val body = JSONObject().put("v", 1).put("sha256", sha256 ?: JSONObject.NULL)
        val response = transport.postJson(
            "/v1/uploads/$uploadId/finish", body, token, TIMEOUT_FINISH, TIMEOUT_FINISH,
        )
        return parse(response) { UploadResult.fromJson(it) }
    }

    fun abort(uploadId: String, token: String) {
        transport.delete("/v1/uploads/$uploadId", token, TIMEOUT_PROBE, TIMEOUT_PROBE)
    }

    fun sendClipboardText(text: String, clientId: String, token: String): ClipboardResponse {
        val body = JSONObject().put("v", 1).put("text", text).put("client_id", clientId)
        val response = transport.postJson(
            "/v1/clipboard/text", body, token, TIMEOUT_CONNECT, TIMEOUT_FINISH,
        )
        return parse(response) { ClipboardResponse.fromJson(it) }
    }

    private fun <T> parse(response: HttpResponse, mapper: (JSONObject) -> T): T {
        if (!response.isSuccess) {
            val error = response.error() ?: ApiError(
                code = "internal",
                message = "HTTP ${response.code}",
                retryable = false,
                hint = "PC 返回异常，请查看 PC 日志",
                requestId = "",
                received = null,
            )
            throw ApiException(error)
        }
        val json = response.json() ?: throw ApiException(
            ApiError(
                code = "internal",
                message = "响应不是合法 JSON",
                retryable = true,
                hint = "PC 返回异常，请查看 PC 日志",
                requestId = "",
                received = null,
            )
        )
        return mapper(json)
    }

    companion object {
        const val TIMEOUT_PROBE = 2_000
        const val TIMEOUT_PAIR = 5_000
        const val TIMEOUT_CONNECT = 5_000
        const val TIMEOUT_BODY = 60_000
        const val TIMEOUT_FINISH = 30_000

        /** 网络层异常统一转成可重试的 ApiException。 */
        fun asApiError(e: IOException): ApiError = ApiError(
            code = "network",
            message = e.message ?: "网络错误",
            retryable = true,
            hint = "连不上 PC，请检查是否同一 Wi-Fi / 访客网络隔离",
            requestId = "",
            received = null,
        )
    }
}
