package com.tea.a2share.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 与 PC 端共用同一份黄金样本（a2-share/tools/vectors/v1.json）。
 *
 * 两端对同一批样本必须给出同一结果——任何一端实现漂移都会在这里暴露。
 */
class VectorsTest {

    private fun vectors(): JSONObject {
        val stream = checkNotNull(javaClass.classLoader!!.getResourceAsStream("v1.json")) {
            "找不到黄金样本 v1.json（Gradle sourceSets.test.resources 应指向 ../../tools/vectors）"
        }
        val text = stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        return JSONObject(text)
    }

    @Test
    fun `合法载荷解析一致`() {
        val cases = vectors().getJSONObject("qr").getJSONArray("valid")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val expect = case.getJSONObject("expect")
            val result = QrPayload.decode(case.getString("payload"))
            assertTrue(result is QrPayload.QrResult.Success)
            val hint = (result as QrPayload.QrResult.Success).hint
            assertEquals(expect.getString("secret"), hint.secret)
            assertEquals(expect.getString("ip"), hint.ip)
            assertEquals(expect.getInt("port"), hint.port)
            assertEquals(expect.getLong("issued"), hint.issued)
            val expectName = if (expect.isNull("name")) null else expect.getString("name")
            assertEquals(expectName, hint.name)
            assertEquals(expect.getInt("length"), case.getString("payload").length)
        }
    }

    @Test
    fun `非法载荷错误码一致`() {
        val cases = vectors().getJSONObject("qr").getJSONArray("invalid")
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val result = QrPayload.decode(case.getString("payload"))
            assertTrue(result is QrPayload.QrResult.Failure)
            val expected = case.getString("error")
            val actual = when ((result as QrPayload.QrResult.Failure).error) {
                QrPayload.ErrorCode.BAD_PAYLOAD -> "bad_payload"
                QrPayload.ErrorCode.BAD_ADDRESS -> "bad_address"
                QrPayload.ErrorCode.BAD_PORT -> "bad_port"
                QrPayload.ErrorCode.PROTOCOL_VERSION -> "protocol_version"
            }
            assertEquals(expected, actual)
        }
    }

    @Test
    fun `名称清洗规则一致`() {
        val cases: JSONArray = vectors().optJSONObject("safe_name")?.optJSONArray("cases")
            ?: JSONArray()
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val raw = case.getString("raw")
            val expect = case.getString("expect")
            assertEquals("raw=$raw", expect, SafeName.clean(raw))
        }
    }

    @Test
    fun `错误信封字段齐全`() {
        val error = vectors().getJSONObject("error_envelope").getJSONObject("error")
        for (field in listOf("code", "message", "retryable", "hint", "request_id")) {
            assertTrue("缺少字段 $field", error.has(field))
        }
    }
}
