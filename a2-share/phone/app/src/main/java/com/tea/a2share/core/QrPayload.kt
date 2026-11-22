package com.tea.a2share.core

/**
 * 二维码载荷编解码（PROTOCOL.md §2）。
 *
 * 载荷格式（alphanumeric，定宽，≤ 51 字节）：
 * ```
 * A2S1-<SECRET:16>-<IP:8>-<PORT:4>-<ISSUED:7>[-<NAME:1..7>]
 * ```
 *
 * 按**固定偏移**解析，不按 `-` 分割（NAME 里可能含 `-`）：
 * secret[5,21) ip[22,30) port[31,35) issued[36,43) name[44..]
 *
 * 本文件是纯 Kotlin，不引用任何 android.*，可在 JVM 单测里直接跑。
 */
object QrPayload {

    const val MAGIC = "A2S1"
    const val BASE_LEN = 43
    const val MAX_LEN = 51

    private const val B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    private val HEX = Regex("^[0-9A-F]+$")
    private val B32_RE = Regex("^[A-Z2-7]+$")
    private val NAME_RE = Regex("^[A-Z0-9-]+$")

    /** 解析出来的配对提示。 */
    data class Hint(
        val secret: String,
        val ip: String,
        val port: Int,
        val issued: Long,
        val name: String?,
    )

    /** 错误码（与 PROTOCOL.md §2.3 的错误名一致）。 */
    enum class ErrorCode { BAD_PAYLOAD, BAD_ADDRESS, BAD_PORT, PROTOCOL_VERSION }

    sealed class QrResult {
        data class Success(val hint: Hint) : QrResult()
        data class Failure(val error: ErrorCode, val message: String) : QrResult()

        val hintOrNull: Hint? get() = (this as? Success)?.hint
        val errorOrNull: ErrorCode? get() = (this as? Failure)?.error
    }

    // ------------------------------------------------------------------ 编码
    fun encode(secret: String, ip: String, port: Int, issued: Long, name: String? = null): String {
        require(secret.length == 16 && B32_RE.matches(secret)) { "secret 必须是 16 位 base32" }
        require(port in 1..65535) { "端口非法" }
        val cleanName = sanitizeName(name)
        val payload = buildString {
            append(MAGIC).append('-')
            append(secret.uppercase()).append('-')
            append(encodeIp(ip)).append('-')
            append(encodePort(port)).append('-')
            append(encodeIssued(issued))
            if (cleanName != null) append('-').append(cleanName)
        }
        require(payload.length <= MAX_LEN) { "载荷过长" }
        return payload
    }

    /** PC 名提示：只保留 A-Z0-9-，取前 7 位；空则整体省略。 */
    fun sanitizeName(name: String?): String? {
        if (name.isNullOrBlank()) return null
        val cleaned = name.uppercase().filter { it in 'A'..'Z' || it in '0'..'9' || it == '-' }
        return cleaned.take(7).ifEmpty { null }
    }

    private fun encodeIp(ip: String): String {
        val parts = ip.split(".")
        require(parts.size == 4) { "非法 IPv4: $ip" }
        return parts.joinToString("") {
            val number = it.toIntOrNull() ?: error("非法 IPv4: $ip")
            require(number in 0..255) { "非法 IPv4: $ip" }
            number.toString(16).uppercase().padStart(2, '0')
        }
    }

    private fun encodePort(port: Int): String =
        port.toString(16).uppercase().padStart(4, '0')

    /** 32 位秒级时间戳 → 7 个 base32 字符（当 35 bit，左边补 3 个 0）。 */
    private fun encodeIssued(issued: Long): String {
        val value = issued.toLong() and 0xFFFFFFFFL
        val sb = StringBuilder(7)
        for (index in 0 until 7) {
            val shift = 5 * (6 - index)
            sb.append(B32[((value shr shift) and 0x1F).toInt()])
        }
        return sb.toString()
    }

    // ------------------------------------------------------------------ 解析
    fun decode(raw: String): QrResult {
        val text = raw.filter { it.isLetterOrDigit() || it == '-' }.trim()
        if (!text.startsWith("$MAGIC-")) {
            return if (Regex("^A2S[0-9]-").containsMatchIn(text)) {
                QrResult.Failure(ErrorCode.PROTOCOL_VERSION, "载荷版本不支持")
            } else {
                QrResult.Failure(ErrorCode.BAD_PAYLOAD, "缺少 A2S1 前缀")
            }
        }
        if (text.length !in BASE_LEN..MAX_LEN) {
            return QrResult.Failure(ErrorCode.BAD_PAYLOAD, "长度非法: ${text.length}")
        }
        val secret = text.substring(5, 21)
        if (!B32_RE.matches(secret)) {
            return QrResult.Failure(ErrorCode.BAD_PAYLOAD, "secret 字符集非法")
        }
        val ip = decodeIp(text.substring(22, 30))
            ?: return QrResult.Failure(ErrorCode.BAD_ADDRESS, "非法 IP 字段")
        val port = decodePort(text.substring(31, 35))
            ?: return QrResult.Failure(ErrorCode.BAD_PORT, "非法端口字段")
        val issued = decodeIssued(text.substring(36, 43))
            ?: return QrResult.Failure(ErrorCode.BAD_PAYLOAD, "非法时间戳字段")
        var name: String? = null
        if (text.length > BASE_LEN) {
            if (text[43] != '-') {
                return QrResult.Failure(ErrorCode.BAD_PAYLOAD, "缺少名字分隔符")
            }
            val candidate = text.substring(44)
            if (candidate.isNotEmpty() && NAME_RE.matches(candidate)) name = candidate
        }
        return QrResult.Success(Hint(secret, ip, port, issued, name))
    }

    private fun decodeIp(hex: String): String? {
        if (hex.length != 8 || !HEX.matches(hex)) return null
        val octets = (0 until 4).map { hex.substring(it * 2, it * 2 + 2).toInt(16) }
        val first = octets[0]
        val second = octets[1]
        if (octets.all { it == 0 }) return null          // 0.0.0.0
        if (first == 127) return null                     // 回环
        if (first == 169 && second == 254) return null    // 链路本地
        if (first in 224..239) return null                // 组播
        if (octets.all { it == 255 }) return null          // 广播
        return octets.joinToString(".")
    }

    private fun decodePort(hex: String): Int? {
        if (hex.length != 4 || !HEX.matches(hex)) return null
        val port = hex.toInt(16)
        if (port == 0) return null
        return port
    }

    private fun decodeIssued(text: String): Long? {
        if (text.length != 7 || !B32_RE.matches(text)) return null
        var value = 0L
        for (ch in text) {
            val index = B32.indexOf(ch)
            if (index < 0) return null
            value = (value shl 5) or index.toLong()
        }
        return value and 0xFFFFFFFFL
    }
}
