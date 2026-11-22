package com.tea.a2share.data

import android.content.ContentResolver
import android.net.Uri
import android.os.StatFs
import java.io.File
import java.io.FileOutputStream

/**
 * 内容文件的落盘位置（app 私有目录）。
 *
 * - `inbox/`：分享进来的内容先复制到这里（FR-P02：content:// URI 的授权是一次性的）；
 * - `queue/`：入队后的内容文件（发送成功后删除）。
 */
class Files(root: File) {

    val inboxDir = File(root, "inbox")
    val queueDir = File(root, "queue")

    init {
        inboxDir.mkdirs()
        queueDir.mkdirs()
    }

    fun queueDirFor(id: String): File = File(queueDir, id).apply { mkdirs() }

    fun inboxDirFor(id: String): File = File(inboxDir, id).apply { mkdirs() }

    /** 把 content:// 的流复制到目标文件（流式，不整文件进内存）。返回字节数。 */
    fun copyFromUri(resolver: ContentResolver, uri: Uri, target: File): Long {
        target.parentFile?.mkdirs()
        var total = 0L
        resolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "无法读取内容: $uri" }
            FileOutputStream(target).use { output ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    output.write(buffer, 0, read)
                    total += read
                }
                output.flush()
            }
        }
        return total
    }

    fun deleteQuietly(path: String?) {
        if (path.isNullOrEmpty()) return
        try {
            File(path).delete()
        } catch (_: SecurityException) {
            // 忽略
        }
    }

    fun exists(path: String?): Boolean =
        !path.isNullOrEmpty() && File(path).exists()

    /** 剩余可用空间（字节）。 */
    fun freeBytes(): Long = try {
        val stat = StatFs(queueDir.absolutePath)
        stat.availableBlocksLong * stat.blockSizeLong
    } catch (_: Exception) {
        Long.MAX_VALUE
    }
}
