package com.tea.a2share.data

import com.tea.a2share.core.Expiry
import com.tea.a2share.core.QuotaPolicy
import java.util.UUID

/**
 * 队列仓库：入队（含额度与淘汰决策）、状态迁移、过期与失效自检。
 *
 * 额度与淘汰在**入队瞬间**完成（同步、事务），不在补发时做——
 * 这样「挤掉谁」对用户可解释（需求 FR-Q02 / FR-Q03）。
 */
class QueueRepository(private val dao: QueueDao, private val files: Files) {

    sealed class EnqueueResult {
        data class Accepted(val item: QueueItem, val evicted: List<QueueItem>) : EnqueueResult()
        data class Rejected(val reason: QuotaPolicy.RejectReason, val message: String) : EnqueueResult()
    }

    /** 入队。 */
    fun enqueue(
        kind: String,
        displayName: String,
        mime: String?,
        size: Long,
        localPath: String?,
        now: Long = System.currentTimeMillis(),
    ): EnqueueResult {
        val policyKind = when (kind) {
            KIND_CLIPBOARD_TEXT -> QuotaPolicy.Kind.CLIPBOARD_TEXT
            KIND_CLIPBOARD_IMAGE -> QuotaPolicy.Kind.CLIPBOARD_IMAGE
            else -> QuotaPolicy.Kind.FILE
        }
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(policyKind, size),
            quotaSnapshot(),
            files.freeBytes(),
        )
        if (decision is QuotaPolicy.Decision.Reject) {
            return EnqueueResult.Rejected(decision.reason, decision.message)
        }
        val evict = (decision as QuotaPolicy.Decision.Accept).evict
        val evictedItems = evict.mapNotNull { dao.findById(it) }
        val item = QueueItem(
            id = UUID.randomUUID().toString(),
            kind = kind,
            displayName = displayName,
            mime = mime,
            size = size,
            localPath = localPath,
            sha256 = null,
            createdAt = now,
            updatedAt = now,
            status = QueueStatus.PENDING,
            attempts = 0,
            lastError = null,
            expiresAt = Expiry.expiresAt(policyKind, now),
            uploadId = null,
            sentOffset = 0,
            targetPcId = null,
            sentAt = null,
        )
        dao.replaceAll(evict, item)
        // 被淘汰的条目：内容文件一并删掉
        evictedItems.forEach { files.deleteQuietly(it.localPath) }
        return EnqueueResult.Accepted(item, evictedItems)
    }

    /** 当前占额度的快照（只统计 PENDING / SENDING / FAILED）。 */
    fun quotaSnapshot(): QuotaPolicy.Snapshot {
        val items = dao.list().filter { it.occupiesQuota }
        return QuotaPolicy.Snapshot(
            files = items.filter { it.kind == KIND_FILE }
                .map { QuotaPolicy.Entry(it.id, it.size, it.createdAt) },
            clipboards = items.filter { it.kind != KIND_FILE }
                .map { QuotaPolicy.Entry(it.id, it.size, it.createdAt) },
        )
    }

    fun list(): List<QueueItem> = dao.list()

    fun find(id: String): QueueItem? = dao.findById(id)

    fun oldestSendable(): QueueItem? = dao.oldestSendable()

    // ------------------------------------------------------------ 状态迁移
    fun markSending(id: String): QueueItem? = mutate(id) {
        it.copy(status = QueueStatus.SENDING, updatedAt = System.currentTimeMillis())
    }

    fun updateOffset(id: String, offset: Long): QueueItem? = mutate(id) {
        it.copy(sentOffset = offset, updatedAt = System.currentTimeMillis())
    }

    fun markSent(id: String, sha256: String?): QueueItem? {
        val updated = mutate(id) {
            it.copy(
                status = QueueStatus.SENT,
                sha256 = sha256 ?: it.sha256,
                sentAt = System.currentTimeMillis(),
                updatedAt = System.currentTimeMillis(),
                localPath = null,
            )
        }
        updated?.let { files.deleteQuietly(it.localPath) }
        return updated
    }

    fun markFailed(id: String, error: String?): QueueItem? = mutate(id) {
        it.copy(
            status = QueueStatus.FAILED,
            attempts = it.attempts + 1,
            lastError = error,
            updatedAt = System.currentTimeMillis(),
        )
    }

    fun markPending(id: String, error: String? = null): QueueItem? = mutate(id) {
        it.copy(status = QueueStatus.PENDING, lastError = error, updatedAt = System.currentTimeMillis())
    }

    /** 重新排队（用户点「重发」）。 */
    fun requeue(id: String): QueueItem? = mutate(id) {
        it.copy(
            status = QueueStatus.PENDING,
            attempts = 0,
            lastError = null,
            updatedAt = System.currentTimeMillis(),
        )
    }

    /** 取消 / 删除（内容文件立即删）。 */
    fun cancel(id: String) {
        val item = dao.findById(id) ?: return
        files.deleteQuietly(item.localPath)
        dao.delete(id)
    }

    fun clearAll(): List<QueueItem> {
        val items = dao.list()
        items.forEach { files.deleteQuietly(it.localPath) }
        dao.deleteAll()
        return items
    }

    fun clearClipboard(): List<QueueItem> {
        val items = dao.list().filter { it.kind != KIND_FILE }
        items.forEach { files.deleteQuietly(it.localPath) }
        items.forEach { dao.delete(it.id) }
        return items
    }

    /** 启动自检：SENDING 回 PENDING；过期条目标灰；文件丢失标「已失效」。 */
    fun selfCheck(now: Long = System.currentTimeMillis()): List<QueueItem> {
        var changed = false
        dao.list().forEach { item ->
            when {
                item.status == QueueStatus.SENDING -> {
                    dao.update(item.copy(status = QueueStatus.PENDING, updatedAt = now))
                    changed = true
                }

                Expiry.isExpired(item.expiresAt, now) && item.status != QueueStatus.EXPIRED -> {
                    dao.update(item.copy(status = QueueStatus.EXPIRED, updatedAt = now))
                    changed = true
                }

                item.localPath != null && item.occupiesQuota && !files.exists(item.localPath) -> {
                    dao.update(item.copy(status = QueueStatus.MISSING, updatedAt = now))
                    changed = true
                }
            }
        }
        return if (changed) dao.list() else emptyList()
    }

    /** 距上次更新的时间是否出现回拨（只告警）。 */
    fun clockRolledBack(now: Long = System.currentTimeMillis()): Boolean {
        val newest = dao.list().maxByOrNull { it.updatedAt } ?: return false
        return Expiry.clockRolledBack(newest.updatedAt, now)
    }

    private fun mutate(id: String, block: (QueueItem) -> QueueItem): QueueItem? {
        val item = dao.findById(id) ?: return null
        val updated = block(item)
        dao.update(updated)
        return updated
    }

    companion object {
        const val KIND_FILE = "file"
        const val KIND_CLIPBOARD_TEXT = "clipboard_text"
        const val KIND_CLIPBOARD_IMAGE = "clipboard_image"
    }
}
