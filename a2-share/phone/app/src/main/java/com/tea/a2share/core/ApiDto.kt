package com.tea.a2share.core

import org.json.JSONObject

/**
 * 线上协议的请求 / 响应 DTO（PROTOCOL.md §3–§4）。
 *
 * 手写 JSON 编解码：报文小、字段少，少一个依赖（NFR-04 的 APK 体积预算）。
 */

data class DeviceInfo(
    val id: String,
    val name: String,
    val model: String,
    val android: Int,
    val app: String,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("name", name)
        .put("model", model)
        .put("android", android)
        .put("app", app)

    companion object {
        fun fromJson(json: JSONObject): DeviceInfo = DeviceInfo(
            id = json.optString("id"),
            name = json.optString("name"),
            model = json.optString("model"),
            android = json.optInt("android"),
            app = json.optString("app"),
        )
    }
}

data class PairRequest(
    val method: String,
    val secret: String? = null,
    val code: String? = null,
    val device: DeviceInfo,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("v", 1)
        .put("method", method)
        .apply {
            secret?.let { put("secret", it) }
            code?.let { put("code", it) }
        }
        .put("device", device.toJson())
}

data class Limits(
    val maxUploadBytes: Long,
    val maxChunkBytes: Int,
    val clipboardTextBytes: Long,
)

data class PairResponse(
    val token: String,
    val sid: String,
    val generation: Int,
    val pcId: String,
    val pcName: String,
    val platform: String,
    val limits: Limits,
    val serverTime: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): PairResponse {
            val session = json.optJSONObject("session") ?: JSONObject()
            val pc = json.optJSONObject("pc") ?: JSONObject()
            val limits = json.optJSONObject("limits") ?: JSONObject()
            return PairResponse(
                token = json.optString("token"),
                sid = session.optString("sid"),
                generation = session.optInt("generation"),
                pcId = pc.optString("id"),
                pcName = pc.optString("name"),
                platform = pc.optString("platform"),
                limits = Limits(
                    maxUploadBytes = limits.optLong("max_upload_bytes", 4L * 1024 * 1024 * 1024),
                    maxChunkBytes = limits.optInt("max_chunk_bytes", 8 * 1024 * 1024),
                    clipboardTextBytes = limits.optLong("clipboard_text_bytes", 1024 * 1024),
                ),
                serverTime = json.optLong("server_time"),
            )
        }
    }
}

data class HelloResponse(
    val name: String,
    val pcId: String,
    val sid: String,
    val paired: Boolean,
    val serverTime: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): HelloResponse = HelloResponse(
            name = json.optString("name"),
            pcId = json.optString("pc_id"),
            sid = json.optString("sid"),
            paired = json.optBoolean("paired"),
            serverTime = json.optLong("t"),
        )
    }
}

data class StatusResponse(
    val sid: String,
    val paired: Boolean,
    val deviceName: String,
    val lastActivity: Long,
    val serverTime: Long,
) {
    companion object {
        fun fromJson(json: JSONObject): StatusResponse {
            val device = json.optJSONObject("device") ?: JSONObject()
            return StatusResponse(
                sid = json.optString("sid"),
                paired = json.optBoolean("paired"),
                deviceName = device.optString("name"),
                lastActivity = json.optLong("last_activity"),
                serverTime = json.optLong("server_time"),
            )
        }
    }
}

data class InitRequest(
    val uploadId: String,
    val kind: String,
    val name: String,
    val size: Long,
    val mime: String,
    val createdAt: Long,
    val sha256: String? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("v", 1)
        .put("upload_id", uploadId)
        .put("kind", kind)
        .put("name", name)
        .put("size", size)
        .put("mime", mime)
        .put("created_at", createdAt)
        .put("sha256", sha256 ?: JSONObject.NULL)
}

data class InitResponse(
    val uploadId: String,
    val received: Long,
    val name: String,
    val resume: Boolean,
    val maxChunkBytes: Int,
) {
    companion object {
        fun fromJson(json: JSONObject): InitResponse = InitResponse(
            uploadId = json.optString("upload_id"),
            received = json.optLong("received"),
            name = json.optString("name"),
            resume = json.optBoolean("resume"),
            maxChunkBytes = json.optInt("max_chunk_bytes", 8 * 1024 * 1024),
        )
    }
}

data class UploadResult(
    val name: String,
    val path: String,
    val size: Long,
    val sha256: String,
    val md5: String,
    val dedup: Boolean,
    val ms: Long,
    val clipboard: String?,
) {
    companion object {
        fun fromJson(json: JSONObject): UploadResult = UploadResult(
            name = json.optString("name"),
            path = json.optString("path"),
            size = json.optLong("size"),
            sha256 = json.optString("sha256"),
            md5 = json.optString("md5"),
            dedup = json.optBoolean("dedup"),
            ms = json.optLong("ms"),
            clipboard = if (json.has("clipboard")) json.optString("clipboard") else null,
        )
    }
}

data class ClipboardResponse(
    val ok: Boolean,
    val clipboard: String,
    val chars: Int,
    val savedAs: String?,
    val reason: String,
) {
    companion object {
        fun fromJson(json: JSONObject): ClipboardResponse = ClipboardResponse(
            ok = json.optBoolean("ok"),
            clipboard = json.optString("clipboard"),
            chars = json.optInt("chars"),
            savedAs = if (json.has("saved_as") && !json.isNull("saved_as")) json.optString("saved_as") else null,
            reason = json.optString("reason"),
        )
    }
}

/** 统一错误信封（PROTOCOL.md §1.3）。 */
data class ApiError(
    val code: String,
    val message: String,
    val retryable: Boolean,
    val hint: String,
    val requestId: String,
    val received: Long?,
) {
    companion object {
        fun fromJson(json: JSONObject): ApiError = ApiError(
            code = json.optString("code"),
            message = json.optString("message"),
            retryable = json.optBoolean("retryable"),
            hint = json.optString("hint"),
            requestId = json.optString("request_id"),
            received = if (json.has("received")) json.optLong("received") else null,
        )
    }

    /** 是否需要用户重新扫码。 */
    val needsRescan: Boolean get() = code == "unauthorized" || code == "session_expired"
}
