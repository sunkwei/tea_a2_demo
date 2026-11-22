package com.tea.a2share.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QuotaPolicyTest {

    private fun entry(id: String, size: Long, createdAt: Long) =
        QuotaPolicy.Entry(id, size, createdAt)

    private fun files(vararg entries: QuotaPolicy.Entry) = QuotaPolicy.Snapshot(files = entries.toList())

    private fun clipboards(vararg entries: QuotaPolicy.Entry) =
        QuotaPolicy.Snapshot(clipboards = entries.toList())

    @Test
    fun `第六个文件挤掉最旧的一个`() {
        val snapshot = files(
            entry("f1", 100, 1), entry("f2", 100, 2), entry("f3", 100, 3),
            entry("f4", 100, 4), entry("f5", 100, 5),
        )
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(QuotaPolicy.Kind.FILE, 100),
            snapshot,
            diskFreeBytes = 10L * 1024 * 1024 * 1024,
        )
        val accept = decision as QuotaPolicy.Decision.Accept
        assertEquals(listOf("f1"), accept.evict)
    }

    @Test
    fun `剪贴板额度与文件额度互不占用`() {
        val snapshot = files(
            entry("f1", 100, 1), entry("f2", 100, 2), entry("f3", 100, 3),
            entry("f4", 100, 4), entry("f5", 100, 5),
        )
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(QuotaPolicy.Kind.CLIPBOARD_TEXT, 10),
            snapshot,
            diskFreeBytes = 10L * 1024 * 1024 * 1024,
        )
        val accept = decision as QuotaPolicy.Decision.Accept
        assertTrue(accept.evict.isEmpty())
    }

    @Test
    fun `第 11 条剪贴板挤掉最旧的一条`() {
        val snapshot = clipboards(*(1..10).map { entry("c$it", 10, it.toLong()) }.toTypedArray())
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(QuotaPolicy.Kind.CLIPBOARD_TEXT, 10),
            snapshot,
            diskFreeBytes = 10L * 1024 * 1024 * 1024,
        )
        val accept = decision as QuotaPolicy.Decision.Accept
        assertEquals(listOf("c1"), accept.evict)
    }

    @Test
    fun `单文件超过 100 MB 被拒`() {
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(QuotaPolicy.Kind.FILE, 320L * 1024 * 1024),
            QuotaPolicy.Snapshot(),
            diskFreeBytes = 10L * 1024 * 1024 * 1024,
        )
        val reject = decision as QuotaPolicy.Decision.Reject
        assertEquals(QuotaPolicy.RejectReason.TOO_LARGE, reject.reason)
        assertTrue(reject.message.contains("100 MB"))
    }

    @Test
    fun `刚好 100 MB 允许入队`() {
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(QuotaPolicy.Kind.FILE, 100L * 1024 * 1024),
            QuotaPolicy.Snapshot(),
            diskFreeBytes = 10L * 1024 * 1024 * 1024,
        )
        assertTrue(decision is QuotaPolicy.Decision.Accept)
    }

    @Test
    fun `文件总量超过 500 MB 时淘汰最旧`() {
        val snapshot = files(
            entry("f1", 200L * 1024 * 1024, 1),
            entry("f2", 200L * 1024 * 1024, 2),
            entry("f3", 200L * 1024 * 1024, 3),
        )
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(QuotaPolicy.Kind.FILE, 100L * 1024 * 1024),
            snapshot,
            diskFreeBytes = 10L * 1024 * 1024 * 1024,
        )
        val accept = decision as QuotaPolicy.Decision.Accept
        assertEquals(listOf("f1"), accept.evict)
    }

    @Test
    fun `空间不足被拒`() {
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(QuotaPolicy.Kind.FILE, 1024),
            QuotaPolicy.Snapshot(),
            diskFreeBytes = 1024,
        )
        val reject = decision as QuotaPolicy.Decision.Reject
        assertEquals(QuotaPolicy.RejectReason.NO_SPACE, reject.reason)
    }

    @Test
    fun `剪贴板图片算剪贴板额度`() {
        val snapshot = clipboards(*(1..10).map { entry("c$it", 10, it.toLong()) }.toTypedArray())
        val decision = QuotaPolicy.onEnqueue(
            QuotaPolicy.NewItem(QuotaPolicy.Kind.CLIPBOARD_IMAGE, 10),
            snapshot,
            diskFreeBytes = 10L * 1024 * 1024 * 1024,
        )
        val accept = decision as QuotaPolicy.Decision.Accept
        assertEquals(listOf("c1"), accept.evict)
    }
}
