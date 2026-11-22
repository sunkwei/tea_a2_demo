package com.tea.a2share.svc

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import com.tea.a2share.App
import com.tea.a2share.R
import com.tea.a2share.core.ApiError
import com.tea.a2share.core.InitRequest
import com.tea.a2share.core.PairState
import com.tea.a2share.core.TransferMachine
import com.tea.a2share.data.QueueItem
import com.tea.a2share.data.QueueRepository
import com.tea.a2share.net.ApiException
import com.tea.a2share.net.PcClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.util.UUID

/**
 * 前台服务：队列泵 + 心跳 + 退避（需求 FR-P12、FR-P22；设计 §7.4 / §7.8）。
 *
 * 有队列或正在传输时保持前台服务，息屏也能继续传（AC-08）；
 * 队列空且 30 分钟无活动就停服务（省电）。
 */
class TransferService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loopJob: Job? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastHeartbeat = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat(getString(R.string.notif_transfer_title))
        if (loopJob == null) {
            loopJob = scope.launch { runLoop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        loopJob?.cancel()
        scope.cancel()
        releaseWakeLock()
        super.onDestroy()
    }

    // -------------------------------------------------------------- 主循环
    private suspend fun runLoop() {
        var idleSince = System.currentTimeMillis()
        while (currentCoroutineContext().isActive) {
            val app = App.instance
            val state = app.pairState.value
            val item = app.repository.oldestSendable()

            if (item != null && state == PairState.CONNECTED && !app.prefs.queuePaused) {
                idleSince = System.currentTimeMillis()
                send(item)
                continue
            }

            if (state == PairState.CONNECTED) {
                val now = System.currentTimeMillis()
                if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
                    lastHeartbeat = now
                    heartbeat()
                }
            }

            if (item == null && System.currentTimeMillis() - idleSince > IDLE_STOP_MS) {
                stopForegroundCompat()
                stopSelf()
                return
            }
            delay(TICK_MS)
        }
    }

    /** 心跳：确认会话还在；401 说明 PC 重启了，需要重新扫码。 */
    private fun heartbeat() {
        val app = App.instance
        val token = app.prefs.token ?: return
        try {
            val status = app.client.status(token)
            app.prefs.lastOkAt = System.currentTimeMillis()
            if (app.prefs.sid != null && app.prefs.sid != status.sid) {
                app.setPairState(PairState.SESSION_EXPIRED)
                app.invalidateSession()
                notifyRescan()
                return
            }
            app.setPairState(PairState.CONNECTED)
        } catch (e: ApiException) {
            if (e.error.needsRescan) {
                app.setPairState(PairState.SESSION_EXPIRED)
                app.invalidateSession()
                notifyRescan()
            } else {
                app.setPairState(PairState.OFFLINE_SAME_WIFI)
            }
        } catch (_: IOException) {
            app.setPairState(PairState.OFFLINE_SAME_WIFI)
        }
    }

    // -------------------------------------------------------------- 发送
    private suspend fun send(item: QueueItem) {
        val app = App.instance
        val token = app.prefs.token
        if (token.isNullOrEmpty()) {
            app.setPairState(PairState.UNPAIRED)
            return
        }
        app.repository.markSending(item.id)
        app.refreshQueue()
        acquireWakeLock()
        try {
            when (item.kind) {
                QueueRepository.KIND_CLIPBOARD_TEXT -> sendClipboardText(item, token)
                else -> sendFile(item, token)
            }
        } catch (e: ApiException) {
            handleFailure(item, e.error)
        } catch (e: IOException) {
            handleFailure(item, PcClient.asApiError(e))
        } finally {
            releaseWakeLock()
            app.refreshQueue()
        }
    }

    private fun sendClipboardText(item: QueueItem, token: String) {
        val app = App.instance
        val path = item.localPath ?: throw IOException("剪贴板内容文件不存在")
        val text = File(path).readText(Charsets.UTF_8)
        val response = app.client.sendClipboardText(text, item.id, token)
        app.repository.markSent(item.id, null)
        Notifications.notify(
            this,
            Notifications.ID_TRANSFER,
            Notifications.build(
                this,
                Notifications.CHANNEL_TRANSFER,
                getString(R.string.channel_transfer),
                response.savedAs?.let { "已保存为 $it" } ?: getString(R.string.clipboard_sent),
            ),
        )
    }

    private fun sendFile(item: QueueItem, token: String) {
        val app = App.instance
        val path = item.localPath ?: throw IOException("内容文件不存在")
        val file = File(path)
        val uploadId = item.uploadId ?: UUID.randomUUID().toString()
        val init = app.client.initUpload(
            InitRequest(
                uploadId = uploadId,
                kind = item.kind,
                name = item.displayName,
                size = item.size,
                mime = item.mime ?: "application/octet-stream",
                createdAt = item.createdAt,
            ),
            token,
        )
        var offset = init.received
        while (offset < item.size) {
            val chunk = readChunk(file, offset) ?: throw IOException("读取内容失败")
            val received = try {
                app.client.putChunk(uploadId, offset, chunk, token)
            } catch (e: ApiException) {
                // 409：对齐服务端偏移后立即重发，不计失败次数
                if (e.error.code == "offset_conflict") {
                    e.error.received ?: throw e
                } else {
                    throw e
                }
            }
            offset = received
            app.repository.updateOffset(item.id, offset)
            updateProgress(item, offset)
        }
        val result = app.client.finish(uploadId, null, token)
        app.repository.markSent(item.id, result.sha256)
        Notifications.notify(
            this,
            Notifications.ID_TRANSFER,
            Notifications.build(
                this,
                Notifications.CHANNEL_TRANSFER,
                getString(R.string.channel_transfer),
                getString(R.string.notif_transfer_done, result.name),
            ),
        )
    }

    private fun readChunk(file: File, offset: Long): ByteArray? = try {
        RandomAccessFile(file, "r").use { raf ->
            raf.seek(offset)
            val buffer = ByteArray(TransferMachine.DEFAULT_CHUNK_BYTES)
            val read = raf.read(buffer)
            if (read <= 0) null else buffer.copyOf(read)
        }
    } catch (e: IOException) {
        null
    }

    private fun handleFailure(item: QueueItem, error: ApiError) {
        val app = App.instance
        if (error.needsRescan) {
            app.setPairState(PairState.SESSION_EXPIRED)
            app.invalidateSession()
            notifyRescan()
            return
        }
        app.repository.markFailed(item.id, error.hint.ifEmpty { error.message })
        if (item.attempts + 1 >= TransferMachine.MAX_ATTEMPTS) {
            Notifications.notify(
                this,
                Notifications.ID_TRANSFER,
                Notifications.build(
                    this,
                    Notifications.CHANNEL_ALERT,
                    getString(R.string.channel_alert),
                    getString(R.string.notif_transfer_failed, item.displayName),
                ),
            )
        }
    }

    // -------------------------------------------------------------- 通知
    private fun updateProgress(item: QueueItem, offset: Long) {
        val percent = if (item.size > 0) (offset * 100 / item.size).toInt() else 0
        startForegroundCompat("${item.displayName} · $percent%")
    }

    private fun notifyRescan() {
        Notifications.notify(
            this,
            Notifications.ID_CONNECTION,
            Notifications.build(
                this,
                Notifications.CHANNEL_CONNECTION,
                getString(R.string.channel_connection),
                getString(R.string.notif_rescan),
            ),
        )
    }

    private fun startForegroundCompat(text: String) {
        val notification = Notifications.foreground(this, text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                Notifications.ID_FOREGROUND,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(Notifications.ID_FOREGROUND, notification)
        }
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock != null) return
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "a2share:transfer").apply {
                setReferenceCounted(false)
                acquire(10 * 60 * 1000L)
            }
        } catch (_: Exception) {
            wakeLock = null
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.takeIf { it.isHeld }?.release()
        } catch (_: Exception) {
            // 忽略
        }
        wakeLock = null
    }

    companion object {
        private const val TICK_MS = 2_000L
        private const val HEARTBEAT_INTERVAL_MS = 20_000L
        private const val IDLE_STOP_MS = 30 * 60 * 1000L

        fun start(context: Context) {
            val intent = Intent(context, TransferService::class.java)
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
                // 后台启动限制时忽略：下次分享会再试
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, TransferService::class.java))
            } catch (_: Exception) {
                // 忽略
            }
        }
    }
}
