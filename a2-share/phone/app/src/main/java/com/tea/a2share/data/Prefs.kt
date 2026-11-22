package com.tea.a2share.data

import android.content.Context
import android.content.SharedPreferences
import java.util.UUID

class Prefs(context: Context) {

    private val sp: SharedPreferences =
        context.applicationContext.getSharedPreferences("a2_share", Context.MODE_PRIVATE)

    /** 本机设备 id（配对时上报给 PC，便于日志关联）。 */
    val deviceId: String
        get() {
            val existing = sp.getString(KEY_DEVICE_ID, null)
            if (existing != null) return existing
            val created = UUID.randomUUID().toString()
            sp.edit().putString(KEY_DEVICE_ID, created).apply()
            return created
        }

    /** 本机显示名（默认机型）。 */
    var deviceName: String
        get() = sp.getString(KEY_DEVICE_NAME, null) ?: android.os.Build.MODEL ?: "Android"
        set(value) = sp.edit().putString(KEY_DEVICE_NAME, value).apply()

    var pcId: String?
        get() = sp.getString(KEY_PC_ID, null)
        set(value) = sp.edit().putString(KEY_PC_ID, value).apply()

    var pcName: String?
        get() = sp.getString(KEY_PC_NAME, null)
        set(value) = sp.edit().putString(KEY_PC_NAME, value).apply()

    var baseUrl: String?
        get() = sp.getString(KEY_BASE_URL, null)
        set(value) = sp.edit().putString(KEY_BASE_URL, value).apply()

    var token: String?
        get() = sp.getString(KEY_TOKEN, null)
        set(value) = sp.edit().putString(KEY_TOKEN, value).apply()

    /** PC 会话 id（PC 重启会变，用来发现「PC 重启了」）。 */
    var sid: String?
        get() = sp.getString(KEY_SID, null)
        set(value) = sp.edit().putString(KEY_SID, value).apply()

    var pairedAt: Long
        get() = sp.getLong(KEY_PAIRED_AT, 0L)
        set(value) = sp.edit().putLong(KEY_PAIRED_AT, value).apply()

    var lastOkAt: Long
        get() = sp.getLong(KEY_LAST_OK_AT, 0L)
        set(value) = sp.edit().putLong(KEY_LAST_OK_AT, value).apply()

    /** 配对时的 Wi-Fi 网络句柄（离开作用域就作废）。 */
    var wifiHandle: String?
        get() = sp.getString(KEY_WIFI_HANDLE, null)
        set(value) = sp.edit().putString(KEY_WIFI_HANDLE, value).apply()

    /** 分享后是否显示确认条（FR-P03，默认开）。 */
    var confirmBeforeSend: Boolean
        get() = sp.getBoolean(KEY_CONFIRM, true)
        set(value) = sp.edit().putBoolean(KEY_CONFIRM, value).apply()

    /** 剪贴板图片是否也写进 PC 剪贴板（与 PC 的 --clipboard-image 对应，默认关）。 */
    var clipboardImageToClipboard: Boolean
        get() = sp.getBoolean(KEY_CLIP_IMAGE, false)
        set(value) = sp.edit().putBoolean(KEY_CLIP_IMAGE, value).apply()

    /** 队列整体暂停（FR-Q11）。 */
    var queuePaused: Boolean
        get() = sp.getBoolean(KEY_PAUSED, false)
        set(value) = sp.edit().putBoolean(KEY_PAUSED, value).apply()

    /** 清空配对凭据（离开 Wi-Fi 作用域 / PC 重启）。 */
    fun clearSession() {
        sp.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_SID)
            .remove(KEY_BASE_URL)
            .remove(KEY_PC_ID)
            .remove(KEY_WIFI_HANDLE)
            .apply()
    }

    private companion object {
        const val KEY_DEVICE_ID = "device_id"
        const val KEY_DEVICE_NAME = "device_name"
        const val KEY_PC_ID = "pc_id"
        const val KEY_PC_NAME = "pc_name"
        const val KEY_BASE_URL = "base_url"
        const val KEY_TOKEN = "token"
        const val KEY_SID = "sid"
        const val KEY_PAIRED_AT = "paired_at"
        const val KEY_LAST_OK_AT = "last_ok_at"
        const val KEY_WIFI_HANDLE = "wifi_handle"
        const val KEY_CONFIRM = "confirm_before_send"
        const val KEY_CLIP_IMAGE = "clipboard_image"
        const val KEY_PAUSED = "queue_paused"
    }
}
