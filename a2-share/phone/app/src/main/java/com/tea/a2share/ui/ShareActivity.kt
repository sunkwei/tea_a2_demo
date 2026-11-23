package com.tea.a2share.ui

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.tea.a2share.App
import com.tea.a2share.R
import com.tea.a2share.data.QueueRepository
import com.tea.a2share.svc.TransferService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/**
 * 分享目标（需求 FR-P01~FR-P03、FR-P17）。
 *
 * 透明主题 + 底部确认条：显示「名称 / 大小 / 目标 PC」，点「发送」才传。
 * 分享进来的 content:// URI 会**当场复制**到 app 私有目录（FR-P02：
 * 授权是一次性的，不能长期持有）。
 */
class ShareActivity : AppCompatActivity() {

    private lateinit var app: App
    private val uris = mutableListOf<Uri>()
    private var textPayload: String? = null
    private var prepared = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = App.instance
        collectIntent(intent)
        if (uris.isEmpty() && textPayload == null) {
            finish()
            return
        }
        setContentView(buildLayout())
        if (!app.prefs.confirmBeforeSend) {
            // 确认条已关闭：直接发送
            send()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        collectIntent(intent)
        if (uris.isEmpty() && textPayload == null) {
            finish()
        }
    }

    private fun collectIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action ?: return
        if (action == Intent.ACTION_SEND_MULTIPLE) {
            val list = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
            if (list != null) uris.addAll(list)
        } else if (action == Intent.ACTION_SEND) {
            val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            if (uri != null) uris.add(uri)
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            if (text != null && uri == null) textPayload = text
        }
    }

    // ---------------------------------------------------------------- 布局
    private fun buildLayout(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.BOTTOM
            setBackgroundColor(Color.TRANSPARENT)
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(16))
            setBackgroundColor(Color.WHITE)
        }
        card.addView(
            TextView(this).apply {
                setText(R.string.share_confirm_title)
                textSize = 16f
            },
        )
        card.addView(
            TextView(this).apply {
                text = summary()
                textSize = 14f
                setTextColor(Color.parseColor("#555555"))
            },
        )
        card.addView(
            TextView(this).apply {
                text = getString(R.string.share_confirm_hint)
                textSize = 12f
                setTextColor(Color.parseColor("#888888"))
            },
        )
        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        buttons.addView(
            Button(this).apply {
                setText(R.string.action_send)
                setOnClickListener { send() }
            },
        )
        buttons.addView(
            Button(this).apply {
                setText(R.string.action_cancel)
                setOnClickListener { finish() }
            },
        )
        card.addView(buttons)
        root.addView(card)
        return root
    }

    private fun summary(): String {
        val target = app.prefs.pcName ?: "未配对的 PC"
        return if (uris.isEmpty()) {
            val text = textPayload ?: ""
            getString(R.string.share_text_preview, text.length) + " → " + target
        } else {
            val names = uris.map { displayName(it) }
            val shown = names.take(3).joinToString("、")
            val more = if (names.size > 3) " 等 ${names.size} 个文件" else ""
            "$shown$more → $target"
        }
    }

    // ---------------------------------------------------------------- 发送
    private fun send() {
        if (prepared) return
        prepared = true
        lifecycleScope.launch {
            var ok = 0
            var failed = 0
            var rejected = 0
            var lastMessage = ""

            if (textPayload != null && uris.isEmpty()) {
                val id = UUID.randomUUID().toString()
                val target = app.files.queueDirFor(id).resolve("clipboard.txt")
                val result = withContext(Dispatchers.IO) {
                    target.parentFile?.mkdirs()
                    target.writeText(textPayload ?: "", Charsets.UTF_8)
                    app.repository.enqueue(
                        kind = QueueRepository.KIND_CLIPBOARD_TEXT,
                        displayName = "剪贴板文字",
                        mime = "text/plain",
                        size = target.length(),
                        localPath = target.absolutePath,
                    )
                }
                when (result) {
                    is QueueRepository.EnqueueResult.Accepted -> ok++
                    is QueueRepository.EnqueueResult.Rejected -> {
                        rejected++
                        lastMessage = result.message
                    }
                }
            }

            for (uri in uris) {
                val id = UUID.randomUUID().toString()
                val name = displayName(uri)
                val target = app.files.queueDirFor(id).resolve(sanitize(name))
                val mime = contentResolver.getType(uri) ?: "application/octet-stream"
                val result = withContext(Dispatchers.IO) {
                    val copied = try {
                        app.files.copyFromUri(contentResolver, uri, target)
                    } catch (e: Exception) {
                        null
                    }
                    if (copied == null) {
                        failed++
                        null
                    } else {
                        app.repository.enqueue(
                            kind = QueueRepository.KIND_FILE,
                            displayName = name,
                            mime = mime,
                            size = copied,
                            localPath = target.absolutePath,
                        )
                    }
                }
                if (result == null) {
                    continue
                }
                when (result) {
                    is QueueRepository.EnqueueResult.Accepted -> {
                        ok++
                        result.evicted.forEach { evicted ->
                            toast(
                                getString(
                                    R.string.toast_evicted,
                                    com.tea.a2share.core.QuotaPolicy.MAX_FILES,
                                    evicted.displayName,
                                ),
                            )
                        }
                    }

                    is QueueRepository.EnqueueResult.Rejected -> {
                        rejected++
                        lastMessage = result.message
                        File(target.absolutePath).delete()
                    }
                }
            }

            app.refreshQueue()
            if (ok > 0) {
                TransferService.start(this@ShareActivity)
                toast(getString(R.string.share_queued))
            } else if (rejected > 0) {
                toast(getString(R.string.toast_rejected, lastMessage))
            } else if (failed > 0) {
                toast(getString(R.string.share_failed, "无法读取分享内容"))
            }
            finish()
        }
    }

    // ---------------------------------------------------------------- 工具
    private fun displayName(uri: Uri): String {
        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) {
                    val name = cursor.getString(index)
                    if (!name.isNullOrBlank()) return name
                }
            }
        } catch (_: Exception) {
            // 落到默认名
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "shared-file"
    }

    private fun sanitize(name: String): String =
        com.tea.a2share.core.SafeName.clean(name).ifEmpty { "shared-file" }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
