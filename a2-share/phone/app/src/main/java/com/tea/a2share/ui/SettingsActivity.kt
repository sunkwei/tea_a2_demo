package com.tea.a2share.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.tea.a2share.App
import com.tea.a2share.R

/**
 * 设置页（需求 FR-P13 / FR-P19 / FR-P20）。
 *
 * 「后台设置」引导页：跳厂商省电策略 / 自启动 / 通知权限（三步都点过才算完成）。
 */
class SettingsActivity : AppCompatActivity() {

    private lateinit var app: App

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = App.instance
        setContentView(buildLayout())
    }

    private fun buildLayout(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }

        root.addView(
            Switch(this).apply {
                setText(R.string.settings_confirm)
                isChecked = app.prefs.confirmBeforeSend
                setOnCheckedChangeListener { _, checked ->
                    app.prefs.confirmBeforeSend = checked
                }
            },
        )
        root.addView(
            TextView(this).apply {
                setText(R.string.settings_confirm_desc)
                textSize = 12f
            },
        )
        root.addView(
            Switch(this).apply {
                text = "剪贴板图片也写入 PC 剪贴板"
                isChecked = app.prefs.clipboardImageToClipboard
                setOnCheckedChangeListener { _, checked ->
                    app.prefs.clipboardImageToClipboard = checked
                }
            },
        )
        root.addView(
            Switch(this).apply {
                text = "暂停队列自动补发"
                isChecked = app.prefs.queuePaused
                setOnCheckedChangeListener { _, checked ->
                    app.prefs.queuePaused = checked
                }
            },
        )

        root.addView(sectionTitle(R.string.settings_background))
        root.addView(
            TextView(this).apply {
                setText(R.string.settings_background_desc)
                textSize = 12f
            },
        )
        root.addView(
            Button(this).apply {
                setText(R.string.settings_step_battery)
                setOnClickListener { openBatterySettings() }
            },
        )
        root.addView(
            Button(this).apply {
                setText(R.string.settings_step_autostart)
                setOnClickListener { openAutoStartSettings() }
            },
        )
        root.addView(
            Button(this).apply {
                setText(R.string.settings_step_notify)
                setOnClickListener { openNotificationSettings() }
            },
        )

        root.addView(sectionTitle(R.string.settings_privacy))
        root.addView(
            TextView(this).apply {
                setText(R.string.settings_privacy_desc)
                textSize = 12f
            },
        )
        root.addView(
            TextView(this).apply {
                setText(R.string.settings_quota)
                textSize = 12f
            },
        )
        root.addView(
            Button(this).apply {
                setText(R.string.settings_clear_queue)
                setOnClickListener {
                    app.repository.clearAll()
                    app.refreshQueue()
                    toast(getString(R.string.toast_cleared))
                }
            },
        )
        return root
    }

    private fun sectionTitle(res: Int): TextView = TextView(this).apply {
        setText(res)
        textSize = 16f
        setPadding(0, dp(20), 0, dp(6))
    }

    // ------------------------------------------------------- 系统设置跳转
    private fun openBatterySettings() {
        val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        startSafely(intent)
    }

    private fun openAutoStartSettings() {
        // 常见厂商的自启动页；没有就退回应用详情页
        val candidates = listOf(
            "com.miui.securitycenter" to "com.miui.permcenter.autostart.AutoStartManagementActivity",
            "com.huawei.systemmanager" to "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity",
            "com.coloros.safecenter" to "com.coloros.safecenter.permission.startup.StartupAppListActivity",
            "com.vivo.permissionmanager" to "com.vivo.permissionmanager.activity.BgStartUpManagerActivity",
            "com.oppo.safe" to "com.oppo.safe.permission.startup.StartupAppListActivity",
        )
        for ((pkg, cls) in candidates) {
            val intent = Intent().setClassName(pkg, cls)
            if (packageManager.resolveActivity(intent, 0) != null) {
                startSafely(intent)
                return
            }
        }
        openAppDetails()
    }

    private fun openNotificationSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", packageName, null))
        }
        startSafely(intent)
    }

    private fun openAppDetails() {
        startSafely(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", packageName, null))
        )
    }

    private fun startSafely(intent: Intent) {
        try {
            startActivity(intent)
        } catch (_: Exception) {
            openAppDetails()
        }
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
