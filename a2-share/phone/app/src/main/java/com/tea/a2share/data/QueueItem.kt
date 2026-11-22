package com.tea.a2share.data

/** 队列条目状态（DESIGN.md §6.2）。 */
enum class QueueStatus {
    /** 待发 / 待重试。 */
    PENDING,

    /** 传输中（杀进程后回 PENDING）。 */
    SENDING,

    /** 已送达。 */
    SENT,

    /** 3 次失败后停留，等用户或新会话。 */
    FAILED,

    /** TTL 到期。 */
    EXPIRED,

    /** 内容文件被系统清理。 */
    MISSING,

    /** 用户删除。 */
    CANCELED;

    companion object {
        fun of(value: String): QueueStatus =
            values().firstOrNull { it.name == value } ?: PENDING
    }
}

/** 队列条目。 */
data class QueueItem(
    val id: String,
    val kind: String,
    val displayName: String,
    val mime: String?,
    val size: Long,
    val localPath: String?,
    val sha256: String?,
    val createdAt: Long,
    val updatedAt: Long,
    val status: QueueStatus,
    val attempts: Int,
    val lastError: String?,
    val expiresAt: Long?,
    val uploadId: String?,
    val sentOffset: Long,
    val targetPcId: String?,
    val sentAt: Long?,
) {
    /** 是否占用条数额度（FR-Q10）。 */
    val occupiesQuota: Boolean
        get() = status == QueueStatus.PENDING ||
            status == QueueStatus.SENDING ||
            status == QueueStatus.FAILED

    /** 是否占用字节额度。 */
    val occupiesBytes: Boolean
        get() = occupiesQuota || status == QueueStatus.EXPIRED
}
