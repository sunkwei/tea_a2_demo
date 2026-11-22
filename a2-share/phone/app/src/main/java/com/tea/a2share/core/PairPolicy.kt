package com.tea.a2share.core

/**
 * 配对状态机（PROTOCOL.md §3.2）。
 *
 * 关键规则：从 LEFT_WIFI 回到 Wi-Fi 后**仍然停在 UNPAIRED**，必须重新扫码
 * （需求 D7 / AC-28）。
 */
enum class PairState {
    UNPAIRED,
    PAIRING,
    CONNECTED,
    OFFLINE_SAME_WIFI,
    LEFT_WIFI,
    NO_WIFI,
    SESSION_EXPIRED,
}

object PairPolicy {

    /** 状态迁移。 */
    fun onWifiAvailable(state: PairState): PairState = when (state) {
        // 离开作用域后回到 Wi-Fi：不自动连、不自动补发，等扫码
        PairState.LEFT_WIFI -> PairState.UNPAIRED
        PairState.NO_WIFI -> PairState.UNPAIRED
        else -> state
    }

    /** 离开 Wi-Fi 作用域（换 AP / 断开 / 切蜂窝）。 */
    fun onWifiLost(state: PairState): PairState = when (state) {
        PairState.CONNECTED, PairState.OFFLINE_SAME_WIFI, PairState.PAIRING -> PairState.LEFT_WIFI
        else -> state
    }

    /** 当前根本不是 Wi-Fi。 */
    fun onNoWifi(state: PairState): PairState = when (state) {
        PairState.CONNECTED, PairState.OFFLINE_SAME_WIFI, PairState.PAIRING -> PairState.NO_WIFI
        else -> state
    }

    fun onPairStart(state: PairState): PairState = PairState.PAIRING

    fun onPairSuccess(state: PairState): PairState = PairState.CONNECTED

    fun onPairFailure(state: PairState): PairState =
        if (state == PairState.CONNECTED) state else PairState.UNPAIRED

    /** 探测成功；sid 变了按「PC 重启」处理。 */
    fun onProbeOk(state: PairState, sidChanged: Boolean): PairState = when {
        sidChanged -> PairState.SESSION_EXPIRED
        else -> PairState.CONNECTED
    }

    /** 探测失败：同一 Wi-Fi 但 PC 没起来。 */
    fun onProbeFailed(state: PairState): PairState = when (state) {
        PairState.CONNECTED, PairState.PAIRING -> PairState.OFFLINE_SAME_WIFI
        else -> state
    }

    /** 收到 401（token 失效 / PC 重启）。 */
    fun onUnauthorized(state: PairState): PairState = PairState.SESSION_EXPIRED

    /** 允许自动连接（心跳 / 补发）。 */
    fun canAutoConnect(state: PairState): Boolean = when (state) {
        PairState.CONNECTED, PairState.OFFLINE_SAME_WIFI, PairState.PAIRING -> true
        else -> false
    }

    /** 允许自动补发队列内容。 */
    fun canAutoResend(state: PairState): Boolean = when (state) {
        PairState.CONNECTED, PairState.OFFLINE_SAME_WIFI -> true
        else -> false
    }

    /** 是否需要提示用户重新扫码。 */
    fun needsRescan(state: PairState): Boolean = when (state) {
        PairState.LEFT_WIFI, PairState.SESSION_EXPIRED -> true
        else -> false
    }

    /** 状态文案（需求 §7：具体、可行动）。 */
    fun statusText(state: PairState, pcName: String?): String = when (state) {
        PairState.UNPAIRED -> "未配对，请扫码连接 PC"
        PairState.PAIRING -> "正在连接…"
        PairState.CONNECTED -> "已连接${pcName?.let { " $it" } ?: ""}"
        PairState.OFFLINE_SAME_WIFI -> "PC 未连接，内容已缓存，PC 上线后会自动发送"
        PairState.LEFT_WIFI -> "已离开原 Wi-Fi，需要重新扫码连接 PC"
        PairState.NO_WIFI -> "当前不是 Wi-Fi，已缓存。等回到 Wi-Fi 再发"
        PairState.SESSION_EXPIRED -> "PC 已重启或配对已失效，请重新扫码"
    }
}
