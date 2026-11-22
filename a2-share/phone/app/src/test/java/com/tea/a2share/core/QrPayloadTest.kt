package com.tea.a2share.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QrPayloadTest {

    private val validPayload = "A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3-SUNKW-X"
    private val barePayload = "A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3"

    @Test
    fun `解析带名字的载荷`() {
        val result = QrPayload.decode(validPayload)
        val hint = (result as QrPayload.QrResult.Success).hint
        assertEquals("K5Q2M7Z3XJ4W6NRA", hint.secret)
        assertEquals("192.168.1.23", hint.ip)
        assertEquals(8899, hint.port)
        assertEquals(1795342523L, hint.issued)
        assertEquals("SUNKW-X", hint.name)
    }

    @Test
    fun `解析不带名字的载荷`() {
        val result = QrPayload.decode(barePayload)
        val hint = (result as QrPayload.QrResult.Success).hint
        assertNull(hint.name)
        assertEquals(43, barePayload.length)
        assertEquals(51, validPayload.length)
    }

    @Test
    fun `编码与解析互逆`() {
        val payload = QrPayload.encode(
            secret = "K5Q2M7Z3XJ4W6NRA",
            ip = "192.168.1.23",
            port = 8899,
            issued = 1795342523L,
            name = "SUNKW-X",
        )
        assertEquals(validPayload, payload)
    }

    @Test
    fun `名字只保留合法字符`() {
        assertEquals("-01", QrPayload.sanitizeName("我的电脑-01"))
        assertEquals("SUNKW-X", QrPayload.sanitizeName("sunkw-x1"))
        assertNull(QrPayload.sanitizeName("我的电脑"))
        assertNull(QrPayload.sanitizeName(""))
    }

    @Test
    fun `载荷长度不超过 51`() {
        val payload = QrPayload.encode("K5Q2M7Z3XJ4W6NRA", "10.0.0.1", 65535, 1L, "A".repeat(40))
        assertTrue(payload.length <= 51)
    }

    @Test
    fun `非法载荷给出对应错误码`() {
        fun expect(payload: String, code: QrPayload.ErrorCode) {
            val result = QrPayload.decode(payload)
            assertNotNull("应当拒绝: $payload", result as? QrPayload.QrResult.Failure)
            assertEquals(code, (result as QrPayload.QrResult.Failure).error)
        }

        expect("A2S2-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3", QrPayload.ErrorCode.PROTOCOL_VERSION)
        expect("A2S1-K5Q2M7Z3XJ4W6NR-C0A80117-22C3-BVQFQF3", QrPayload.ErrorCode.BAD_PAYLOAD)
        expect("A2S1-K5Q2M7Z3XJ4W6NRA-7F000001-22C3-BVQFQF3", QrPayload.ErrorCode.BAD_ADDRESS)
        expect("A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-0000-BVQFQF3", QrPayload.ErrorCode.BAD_PORT)
        expect("a2s1-k5q2m7z3xj4w6nra-c0a80117-22c3-bvqfqf3", QrPayload.ErrorCode.BAD_PAYLOAD)
        expect("A2S1-K5Q2M7Z3XJ4W6NRA-C0A80117-22C3-BVQFQF3-SUNKW-X-EXTRA", QrPayload.ErrorCode.BAD_PAYLOAD)
        expect("HELLO-WORLD", QrPayload.ErrorCode.BAD_PAYLOAD)
    }
}
