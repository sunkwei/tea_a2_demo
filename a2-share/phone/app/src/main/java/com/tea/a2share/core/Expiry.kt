package com.tea.a2share.core

/**
 * TTL 判定（需求 FR-Q07）。
 *
 * 只用墙上时间（`created_at` + `expires_at`）。TTL 是省存储的策略，不是安全边界，
 * 所以检测到系统时间回拨时只告警、不批量判过期。
 */
object Expiry {

    /** 剪贴板条目默认 24 小时。 */
    const val CLIPBOARD_TTL_MS = 24L * 60 * 60 * 1000

    /** 文件条目默认 7 天。 */
    const val FILE_TTL_MS = 7L * 24 * 60 * 60 * 1000

    /** 时间回拨告警阈值：1 小时。 */
    const val CLOCK_ROLLBACK_THRESHOLD_MS = 60L * 60 * 1000

    fun ttlFor(kind: QuotaPolicy.Kind): Long = when (kind) {
        QuotaPolicy.Kind.FILE -> FILE_TTL_MS
        QuotaPolicy.Kind.CLIPBOARD_TEXT, QuotaPolicy.Kind.CLIPBOARD_IMAGE -> CLIPBOARD_TTL_MS
    }

    fun expiresAt(kind: QuotaPolicy.Kind, createdAt: Long): Long = createdAt + ttlFor(kind)

    fun isExpired(expiresAt: Long?, now: Long): Boolean =
        expiresAt != null && expiresAt > 0 && now >= expiresAt

    /** 系统时间是否被回拨（只告警，不清数据）。 */
    fun clockRolledBack(lastUpdatedAt: Long, now: Long): Boolean =
        lastUpdatedAt > 0 && now + CLOCK_ROLLBACK_THRESHOLD_MS < lastUpdatedAt
}
