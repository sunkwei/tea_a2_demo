package com.tea.a2share.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest

/**
 * Wi-Fi 作用域监视（需求 FR-P16 / FR-L04）。
 *
 * 判定依据只取「Wi-Fi 传输类型 + Network 句柄」，**不读 SSID/BSSID**（避免申请定位权限）。
 * 同一个 AP 重新连接也会换 Network 对象 → 触发作废，符合 AC-28/29 的产品决策。
 */
class ConnectivityMonitor(context: Context) {

    private val manager =
        context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    /** 当前 Wi-Fi 网络（null = 不是 Wi-Fi 或已离开作用域）。 */
    @Volatile
    var currentNetwork: Network? = null
        private set

    /** 进入 Wi-Fi 作用域。 */
    var onWifiAvailable: (() -> Unit)? = null

    /** 离开 Wi-Fi 作用域（换 AP / 断开 / 切蜂窝）。 */
    var onWifiLost: (() -> Unit)? = null

    /** 同一个 Wi-Fi 内换了 Network 对象（地址可能变了）。 */
    var onScopeChanged: (() -> Unit)? = null

    private var started = false

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (!isWifi(network)) return
            val previous = currentNetwork
            currentNetwork = network
            if (previous == null) {
                onWifiAvailable?.invoke()
            } else if (previous != network) {
                onScopeChanged?.invoke()
            }
        }

        override fun onLost(network: Network) {
            if (currentNetwork == null || currentNetwork == network) {
                currentNetwork = null
                onWifiLost?.invoke()
            }
        }

        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
            if (!isWifi(network)) {
                if (currentNetwork == network) {
                    currentNetwork = null
                    onWifiLost?.invoke()
                }
            }
        }
    }

    fun start() {
        if (started) return
        started = true
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .build()
        try {
            manager.registerNetworkCallback(request, callback)
        } catch (_: SecurityException) {
            // 权限异常时退化为「按需查询」
        }
        refresh()
    }

    fun stop() {
        if (!started) return
        started = false
        try {
            manager.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
            // 忽略
        }
        currentNetwork = null
    }

    /** 当前是否在 Wi-Fi 上。 */
    fun isWifiNow(): Boolean {
        val network = currentNetwork
        if (network == null) return false
        return isWifi(network)
    }

    /** 当前网络的标识（句柄字符串），用于判断是否还在同一个作用域。 */
    fun currentHandle(): String? = currentNetwork?.toString()

    private fun refresh() {
        val active = manager.activeNetwork
        if (active != null && isWifi(active)) {
            if (currentNetwork == null) {
                currentNetwork = active
                onWifiAvailable?.invoke()
            } else if (currentNetwork != active) {
                onScopeChanged?.invoke()
            }
        } else if (currentNetwork != null) {
            currentNetwork = null
            onWifiLost?.invoke()
        }
    }

    private fun isWifi(network: Network): Boolean = try {
        val caps = manager.getNetworkCapabilities(network)
        caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
    } catch (_: Exception) {
        false
    }
}
