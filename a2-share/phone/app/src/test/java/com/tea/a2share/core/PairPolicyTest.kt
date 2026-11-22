package com.tea.a2share.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PairPolicyTest {

    @Test
    fun `离开 Wi-Fi 作用域立即作废`() {
        assertEquals(PairState.LEFT_WIFI, PairPolicy.onWifiLost(PairState.CONNECTED))
        assertEquals(PairState.LEFT_WIFI, PairPolicy.onWifiLost(PairState.OFFLINE_SAME_WIFI))
    }

    @Test
    fun `切到蜂窝变成不是 Wi-Fi`() {
        assertEquals(PairState.NO_WIFI, PairPolicy.onNoWifi(PairState.CONNECTED))
    }

    @Test
    fun `回到 Wi-Fi 后仍需重新扫码`() {
        val state = PairPolicy.onWifiAvailable(PairState.LEFT_WIFI)
        assertEquals(PairState.UNPAIRED, state)
        assertFalse(PairPolicy.canAutoConnect(state))
        assertFalse(PairPolicy.canAutoResend(state))
    }

    @Test
    fun `未配对与失效都不自动连`() {
        assertFalse(PairPolicy.canAutoConnect(PairState.UNPAIRED))
        assertFalse(PairPolicy.canAutoConnect(PairState.SESSION_EXPIRED))
        assertFalse(PairPolicy.canAutoConnect(PairState.LEFT_WIFI))
        assertFalse(PairPolicy.canAutoConnect(PairState.NO_WIFI))
    }

    @Test
    fun `已连接可以自动连与自动补发`() {
        assertTrue(PairPolicy.canAutoConnect(PairState.CONNECTED))
        assertTrue(PairPolicy.canAutoResend(PairState.CONNECTED))
        assertTrue(PairPolicy.canAutoConnect(PairState.OFFLINE_SAME_WIFI))
    }

    @Test
    fun `sid 变化按 PC 重启处理`() {
        assertEquals(PairState.SESSION_EXPIRED, PairPolicy.onProbeOk(PairState.CONNECTED, sidChanged = true))
        assertEquals(PairState.CONNECTED, PairPolicy.onProbeOk(PairState.CONNECTED, sidChanged = false))
    }

    @Test
    fun `401 直接进入需要重扫`() {
        assertEquals(PairState.SESSION_EXPIRED, PairPolicy.onUnauthorized(PairState.CONNECTED))
        assertTrue(PairPolicy.needsRescan(PairState.SESSION_EXPIRED))
        assertTrue(PairPolicy.needsRescan(PairState.LEFT_WIFI))
    }

    @Test
    fun `配对成功后进入已连接`() {
        val state = PairPolicy.onPairSuccess(PairState.PAIRING)
        assertEquals(PairState.CONNECTED, state)
        assertTrue(PairPolicy.canAutoResend(state))
    }

    @Test
    fun `文案是具体可行动的`() {
        assertTrue(PairPolicy.statusText(PairState.UNPAIRED, null).contains("扫码"))
        assertTrue(PairPolicy.statusText(PairState.CONNECTED, "SUNKW").contains("SUNKW"))
        assertTrue(PairPolicy.statusText(PairState.OFFLINE_SAME_WIFI, null).contains("缓存"))
        assertTrue(PairPolicy.statusText(PairState.LEFT_WIFI, null).contains("重新扫码"))
        assertTrue(PairPolicy.statusText(PairState.NO_WIFI, null).contains("Wi-Fi"))
    }
}
