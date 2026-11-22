package com.tea.a2share.core

import java.text.Normalizer

/**
 * 文件名清洗（与 PC 端 `pc/a2share/safe_name.py` 同规则，PROTOCOL.md §6.1）。
 *
 * 手机端用同名规则只是为了让队列里显示的名字与最终落地一致；
 * PC 端是权威实现，最终以 PC 返回的 `name` 为准。
 */
object SafeName {

    private val RESERVED = buildSet {
        addAll(listOf("CON", "PRN", "AUX", "NUL"))
        (1..9).forEach { add("COM$it"); add("LPT$it") }
    }

    private const val ILLEGAL = "/\\:*?\"<>|"
    const val MAX_NAME_BYTES = 180
    const val MAX_EXT_BYTES = 20

    fun clean(raw: String?): String {
        var text = Normalizer.normalize(raw ?: "", Normalizer.Form.NFC)
        // 只取最后一段（按 / 与 \ 切）
        text = text.substringAfterLast('/').substringAfterLast('\\')
        // 去控制字符
        text = text.filter { it.code >= 0x20 && it.code != 0x7F }
        // 非法字符换 _
        text = text.map { if (it in ILLEGAL) '_' else it }.joinToString("")
        // 去首尾空格、去结尾的点
        text = text.trim(' ').trimEnd('.')
        // 保留名加前缀
        val (stem, ext) = splitExt(text)
        val newStem = if (stem.uppercase() in RESERVED) "_$stem" else stem
        text = newStem + ext
        // 限长
        text = truncate(text, MAX_NAME_BYTES)
        // 空结果兜底
        if (text.isEmpty()) text = "file-${System.currentTimeMillis()}"
        return text
    }

    private fun splitExt(name: String): Pair<String, String> {
        val index = name.lastIndexOf('.')
        if (index <= 0) return name to ""
        return name.substring(0, index) to name.substring(index)
    }

    private fun truncate(name: String, limit: Int): String {
        if (name.toByteArray(Charsets.UTF_8).size <= limit) return name
        var (stem, ext) = splitExt(name)
        if (ext.toByteArray(Charsets.UTF_8).size > MAX_EXT_BYTES) {
            stem = name
            ext = ""
        }
        var keep = maxOf(1, limit - ext.toByteArray(Charsets.UTF_8).size)
        var encoded = stem.toByteArray(Charsets.UTF_8)
        if (encoded.size <= keep) return stem + ext
        while (keep > 0 && (encoded[keep].toInt() and 0xC0) == 0x80) keep--
        val cut = String(encoded, 0, keep, Charsets.UTF_8)
        return (cut.ifEmpty { "file" }) + ext
    }
}
