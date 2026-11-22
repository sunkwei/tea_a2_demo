package com.tea.a2share.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ExpiryTest {

    @Test
    fun `剪贴板默认 24 小时过期`() {
        assertEquals(24L * 60 * 60 * 1000, Expiry.ttlFor(QuotaPolicy.Kind.CLIPBOARD_TEXT))
    }

    @Test
    fun `文件默认 7 天过期`() {
        assertEquals(7L * 24 * 60 * 60 * 1000, Expiry.ttlFor(QuotaPolicy.Kind.FILE))
    }

    @Test
    fun `到期判定`() {
        val now = 1_000_000L
        assertFalse(Expiry.isExpired(now + 1000, now))
        assertTrue(Expiry.isExpired(now - 1, now))
        assertFalse(Expiry.isExpired(null, now))
    }

    @Test
    fun `过期时间点等于到期`() {
        val now = 1_000_000L
        assertTrue(Expiry.isExpired(now, now))
    }

    @Test
    fun `时间回拨只告警不清数据`() {
        val lastUpdated = 10_000_000L
        assertTrue(Expiry.clockRolledBack(lastUpdated, lastUpdated - 2 * 60 * 60 * 1000))
        assertFalse(Expiry.clockRolledBack(lastUpdated, lastUpdated + 1000))
        assertFalse(Expiry.clockRolledBack(0, 0))
    }
}
