package com.tea.a2share.core

/**
 * 队列额度与淘汰决策（需求 FR-Q01~FR-Q05、FR-Q10）。
 *
 * 两个**独立额度**：文件 5 个、剪贴板 10 条，互不占用。
 * 淘汰策略 FIFO：新条目入队时若超额度，挤掉最旧的一条。
 * 额度在**入队瞬间**判定（同步、事务），不在补发时做——这样「挤掉谁」对用户可解释。
 */
object QuotaPolicy {

    const val MAX_FILES = 5
    const val MAX_CLIPBOARD = 10
    const val MAX_FILE_BYTES = 100L * 1024 * 1024
    const val MAX_TOTAL_FILE_BYTES = 500L * 1024 * 1024
    const val MAX_CLIPBOARD_BYTES = 10L * 1024 * 1024

    /** 落盘时额外留出的余量（内容文件 + 临时文件）。 */
    const val DISK_MARGIN_BYTES = 32L * 1024 * 1024

    enum class Kind { FILE, CLIPBOARD_TEXT, CLIPBOARD_IMAGE }

    enum class RejectReason { TOO_LARGE, NOT_ENOUGH_BYTES, NO_SPACE }

    data class NewItem(val kind: Kind, val sizeBytes: Long)

    /** 队列里的一条（用于 FIFO 淘汰）。 */
    data class Entry(val id: String, val sizeBytes: Long, val createdAt: Long)

    /**
     * 当前占用额度的快照。
     *
     * 只统计**占额度**的状态：PENDING / SENDING / FAILED（需求 FR-Q10）。
     * SENT / EXPIRED / MISSING / CANCELED 不占条数额度。
     */
    data class Snapshot(
        val files: List<Entry> = emptyList(),
        val clipboards: List<Entry> = emptyList(),
    ) {
        val fileCount: Int get() = files.size
        val clipboardCount: Int get() = clipboards.size
        val fileBytes: Long get() = files.sumOf { it.sizeBytes }
        val clipboardBytes: Long get() = clipboards.sumOf { it.sizeBytes }
    }

    sealed class Decision {
        /** 接受新条目，同时淘汰这些条目（id）。 */
        data class Accept(val evict: List<String>) : Decision()

        /** 拒绝入队，必须给出可展示的原因。 */
        data class Reject(val reason: RejectReason, val message: String) : Decision()
    }

    /**
     * 入队决策。
     *
     * @param item 新条目
     * @param snapshot 当前占额度的队列快照
     * @param diskFreeBytes 手机剩余可用空间
     */
    fun onEnqueue(item: NewItem, snapshot: Snapshot, diskFreeBytes: Long): Decision {
        // 空间护栏：先看剩余空间够不够（条目本身 + 余量）
        if (diskFreeBytes < item.sizeBytes + DISK_MARGIN_BYTES) {
            return Decision.Reject(RejectReason.NO_SPACE, "手机存储空间不足，未缓存")
        }
        return when (item.kind) {
            Kind.FILE -> decideFile(item, snapshot)
            Kind.CLIPBOARD_TEXT, Kind.CLIPBOARD_IMAGE -> decideClipboard(item, snapshot)
        }
    }

    private fun decideFile(item: NewItem, snapshot: Snapshot): Decision {
        if (item.sizeBytes > MAX_FILE_BYTES) {
            val mb = item.sizeBytes / (1024 * 1024)
            return Decision.Reject(
                RejectReason.TOO_LARGE,
                "文件 $mb MB 超过 100 MB 上限，未缓存",
            )
        }
        val evict = mutableListOf<String>()
        var count = snapshot.fileCount
        var bytes = snapshot.fileBytes
        val oldest = snapshot.files.sortedBy { it.createdAt }
        var index = 0
        while ((count + 1 > MAX_FILES || bytes + item.sizeBytes > MAX_TOTAL_FILE_BYTES) && index < oldest.size) {
            val victim = oldest[index]
            evict.add(victim.id)
            count -= 1
            bytes -= victim.sizeBytes
            index++
        }
        if (count + 1 > MAX_FILES || bytes + item.sizeBytes > MAX_TOTAL_FILE_BYTES) {
            return Decision.Reject(
                RejectReason.NOT_ENOUGH_BYTES,
                "缓存空间不足（上限 500 MB），未缓存",
            )
        }
        return Decision.Accept(evict)
    }

    private fun decideClipboard(item: NewItem, snapshot: Snapshot): Decision {
        if (item.sizeBytes > MAX_CLIPBOARD_BYTES) {
            return Decision.Reject(RejectReason.TOO_LARGE, "剪贴板内容超过 10 MB，未缓存")
        }
        val evict = mutableListOf<String>()
        var count = snapshot.clipboardCount
        var bytes = snapshot.clipboardBytes
        val oldest = snapshot.clipboards.sortedBy { it.createdAt }
        var index = 0
        while ((count + 1 > MAX_CLIPBOARD || bytes + item.sizeBytes > MAX_CLIPBOARD_BYTES) && index < oldest.size) {
            val victim = oldest[index]
            evict.add(victim.id)
            count -= 1
            bytes -= victim.sizeBytes
            index++
        }
        if (count + 1 > MAX_CLIPBOARD || bytes + item.sizeBytes > MAX_CLIPBOARD_BYTES) {
            return Decision.Reject(
                RejectReason.NOT_ENOUGH_BYTES,
                "剪贴板缓存空间不足，未缓存",
            )
        }
        return Decision.Accept(evict)
    }
}
