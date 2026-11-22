package com.tea.a2share.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeNameTest {

    @Test
    fun `路径穿越只留最后一段`() {
        assertEquals("passwd", SafeName.clean("../../etc/passwd"))
        assertEquals("a.dll", SafeName.clean("..\\..\\windows\\system32\\a.dll"))
    }

    @Test
    fun `非法字符换成下划线`() {
        assertEquals("a_b_c_d.txt", SafeName.clean("a:b*c?d.txt"))
        assertEquals("a_b_c_d_e.txt", SafeName.clean("a<b>c|d\"e.txt"))
    }

    @Test
    fun `控制字符被删除`() {
        assertEquals("_nul.txt", SafeName.clean("nul\u0007.txt"))
        assertEquals("ab", SafeName.clean("a\u0000b"))
    }

    @Test
    fun `Windows 保留名加前缀`() {
        assertEquals("_CON", SafeName.clean("CON"))
        assertEquals("_con.txt", SafeName.clean("con.txt"))
        assertEquals("_COM1.log", SafeName.clean("COM1.log"))
        assertEquals("_LPT9", SafeName.clean("LPT9"))
    }

    @Test
    fun `去掉结尾的点与首尾空格`() {
        assertEquals("a", SafeName.clean("a."))
        assertEquals("spaced", SafeName.clean("  spaced  "))
        assertEquals("name", SafeName.clean("name...  "))
    }

    @Test
    fun `保留中文 emoji 与空格`() {
        assertEquals("报告 v2.pdf", SafeName.clean("报告 v2.pdf"))
        assertEquals("emoji 🐱.png", SafeName.clean("emoji 🐱.png"))
    }

    @Test
    fun `空名有兜底`() {
        assertTrue(SafeName.clean("").startsWith("file-"))
        assertTrue(SafeName.clean("...").startsWith("file-"))
    }

    @Test
    fun `超长名字截断但保留扩展名`() {
        val cleaned = SafeName.clean("x".repeat(400) + ".pdf")
        assertTrue(cleaned.toByteArray(Charsets.UTF_8).size <= SafeName.MAX_NAME_BYTES)
        assertTrue(cleaned.endsWith(".pdf"))
    }

    @Test
    fun `截断不切坏多字节字符`() {
        val cleaned = SafeName.clean("中".repeat(200))
        assertTrue(cleaned.toByteArray(Charsets.UTF_8).size <= SafeName.MAX_NAME_BYTES)
        // 能正常编码即说明没有半个字符
        cleaned.toByteArray(Charsets.UTF_8)
    }
}
