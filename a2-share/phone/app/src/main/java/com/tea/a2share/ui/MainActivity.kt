package com.tea.a2share.ui

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.tea.a2share.App
import com.tea.a2share.R
import com.tea.a2share.core.PairPolicy
import com.tea.a2share.core.PairState
import com.tea.a2share.data.QueueItem
import com.tea.a2share.data.QueueStatus
import com.tea.a2share.svc.TransferService
import kotlinx.coroutines.launch

/**
 * 主界面：连接状态 + 队列（需求 FR-P06 / FR-P07 / FR-P14）。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var queueContainer: LinearLayout
    private lateinit var emptyHint: TextView
    private lateinit var app: App

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = App.instance
        setContentView(buildLayout())
        observeState()
    }

    override fun onResume() {
        super.onResume()
        app.refreshQueue()
        renderQueue(app.queue.value)
    }

    // ---------------------------------------------------------------- 布局
    private fun buildLayout(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }

        statusText = TextView(this).apply {
            textSize = 18f
            setTextColor(Color.parseColor("#1B5E20"))
        }
        root.addView(statusText)

        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.START
        }
        buttons.addView(
            Button(this).apply {
                setText(R.string.action_scan)
                setOnClickListener {
                    startActivity(Intent(this@MainActivity, ScanActivity::class.java))
                }
            },
        )
        buttons.addView(
            Button(this).apply {
                setText(R.string.action_send_clipboard)
                setOnClickListener { sendClipboard() }
            },
        )
        buttons.addView(
            Button(this).apply {
                setText(R.string.action_settings)
                setOnClickListener {
                    startActivity(Intent(this@MainActivity, SettingsActivity::class.java))
                }
            },
        )
        root.addView(buttons)

        root.addView(
            TextView(this).apply {
                setText(R.string.label_queue)
                textSize = 16f
                setPadding(0, dp(16), 0, dp(8))
            },
        )

        queueContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        root.addView(queueContainer)

        emptyHint = TextView(this).apply {
            setText(R.string.label_empty_queue)
            visibility = View.GONE
        }
        root.addView(emptyHint)

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        actions.addView(
            Button(this).apply {
                setText(R.string.action_retry_all)
                setOnClickListener { retryAll() }
            },
        )
        actions.addView(
            Button(this).apply {
                setText(R.string.action_clear_clipboard)
                setOnClickListener {
                    app.repository.clearClipboard()
                    app.refreshQueue()
                    renderQueue(app.queue.value)
                }
            },
        )
        root.addView(actions)

        return ScrollView(this).apply { addView(root) }
    }

    // ---------------------------------------------------------------- 状态
    private fun observeState() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    app.pairState.collect { state ->
                        statusText.text = PairPolicy.statusText(state, app.prefs.pcName)
                    }
                }
                launch {
                    app.queue.collect { items -> renderQueue(items) }
                }
            }
        }
    }

    private fun renderQueue(items: List<QueueItem>) {
        queueContainer.removeAllViews()
        emptyHint.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        items.forEach { item ->
            queueContainer.addView(buildQueueRow(item))
        }
    }

    private fun buildQueueRow(item: QueueItem): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(8), 0, dp(8))
        }
        val title = TextView(this).apply {
            text = "${item.displayName} · ${statusLabel(item.status)}"
            textSize = 15f
        }
        row.addView(title)
        val detail = TextView(this).apply {
            text = "${formatSize(item.size)} · ${formatTime(item.createdAt)}"
            textSize = 12f
        }
        row.addView(detail)
        item.lastError?.let { error ->
            row.addView(
                TextView(this).apply {
                    text = error
                    textSize = 12f
                    setTextColor(Color.parseColor("#C62828"))
                },
            )
        }

        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        if (item.status == QueueStatus.PENDING || item.status == QueueStatus.FAILED) {
            actions.addView(
                Button(this).apply {
                    setText(R.string.action_resend)
                    setOnClickListener {
                        app.repository.requeue(item.id)
                        app.refreshQueue()
                        TransferService.start(this@MainActivity)
                    }
                },
            )
        }
        actions.addView(
            Button(this).apply {
                setText(R.string.action_delete)
                setOnClickListener {
                    app.repository.cancel(item.id)
                    app.refreshQueue()
                    renderQueue(app.queue.value)
                }
            },
        )
        row.addView(actions)
        return row
    }

    private fun statusLabel(status: QueueStatus): String = getString(
        when (status) {
            QueueStatus.PENDING -> R.string.status_pending
            QueueStatus.SENDING -> R.string.status_sending
            QueueStatus.SENT -> R.string.status_sent
            QueueStatus.FAILED -> R.string.status_failed
            QueueStatus.EXPIRED -> R.string.status_expired
            QueueStatus.MISSING -> R.string.status_missing
            QueueStatus.CANCELED -> R.string.status_canceled
        }
    )

    private fun retryAll() {
        app.repository.list().filter {
            it.status == QueueStatus.PENDING || it.status == QueueStatus.FAILED
        }.forEach { app.repository.requeue(it.id) }
        app.refreshQueue()
        TransferService.start(this)
    }

    // ------------------------------------------------------------ 剪贴板
    private fun sendClipboard() {
        val clipboard = getSystemService(android.content.ClipboardManager::class.java)
        val clip = clipboard?.primaryClip
        if (clip == null || clip.itemCount == 0) {
            toast(getString(R.string.clipboard_empty))
            return
        }
        val item = clip.getItemAt(0)
        val text = item.text?.toString()
        val uri = item.uri
        if (text.isNullOrEmpty() && uri == null) {
            toast(getString(R.string.clipboard_no_image))
            return
        }
        if (uri != null) {
            // 剪贴板图片：复制成 png 走文件链路（FR-P04 / FR-P05）
            val id = java.util.UUID.randomUUID().toString()
            val target = app.files.queueDirFor(id).resolve("clipboard.png")
            try {
                app.files.copyFromUri(contentResolver, uri, target)
            } catch (e: Exception) {
                toast(getString(R.string.clipboard_no_image))
                return
            }
            val size = target.length()
            val result = app.repository.enqueue(
                kind = com.tea.a2share.data.QueueRepository.KIND_CLIPBOARD_IMAGE,
                displayName = "clipboard.png",
                mime = "image/png",
                size = size,
                localPath = target.absolutePath,
            )
            handleEnqueue(result, id)
            return
        }
        val id = java.util.UUID.randomUUID().toString()
        val target = app.files.queueDirFor(id).resolve("clipboard.txt")
        target.parentFile?.mkdirs()
        target.writeText(text ?: "", Charsets.UTF_8)
        val result = app.repository.enqueue(
            kind = com.tea.a2share.data.QueueRepository.KIND_CLIPBOARD_TEXT,
            displayName = "剪贴板文字",
            mime = "text/plain",
            size = target.length(),
            localPath = target.absolutePath,
        )
        handleEnqueue(result, id)
    }

    private fun handleEnqueue(result: com.tea.a2share.data.QueueRepository.EnqueueResult, id: String) {
        when (result) {
            is com.tea.a2share.data.QueueRepository.EnqueueResult.Accepted -> {
                result.evicted.forEach { evicted ->
                    toast(
                        getString(
                            R.string.toast_evicted,
                            com.tea.a2share.core.QuotaPolicy.MAX_FILES,
                            evicted.displayName,
                        ),
                    )
                }
                toast(getString(R.string.share_queued))
                TransferService.start(this)
            }

            is com.tea.a2share.data.QueueRepository.EnqueueResult.Rejected -> {
                app.files.deleteQuietly(app.files.queueDirFor(id).absolutePath)
                toast(getString(R.string.toast_rejected, result.message))
            }
        }
        app.refreshQueue()
        renderQueue(app.queue.value)
    }

    private fun toast(message: String) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show()
    }

    private fun formatSize(size: Long): String = when {
        size >= 1024 * 1024 -> "${size / (1024 * 1024)} MB"
        size >= 1024 -> "${size / 1024} KB"
        else -> "$size B"
    }

    private fun formatTime(millis: Long): String =
        java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.getDefault())
            .format(java.util.Date(millis))

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
