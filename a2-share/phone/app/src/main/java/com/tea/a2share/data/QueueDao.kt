package com.tea.a2share.data

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase

/** 队列表的 DAO（事务性增删改查）。 */
class QueueDao(private val helper: DbHelper) {

    fun insert(item: QueueItem) {
        val db = helper.writableDatabase
        db.insertWithOnConflict("queue", null, item.toValues(), SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun update(item: QueueItem) {
        helper.writableDatabase.update(
            "queue",
            item.toValues(),
            "id = ?",
            arrayOf(item.id),
        )
    }

    fun delete(id: String) {
        helper.writableDatabase.delete("queue", "id = ?", arrayOf(id))
    }

    fun deleteAll(): Int = helper.writableDatabase.delete("queue", null, null)

    fun deleteByKind(kind: String): Int =
        helper.writableDatabase.delete("queue", "kind = ?", arrayOf(kind))

    fun findById(id: String): QueueItem? =
        helper.readableDatabase.query(
            "queue", null, "id = ?", arrayOf(id), null, null, null, "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toItem() else null }

    fun list(): List<QueueItem> =
        helper.readableDatabase.query(
            "queue", null, null, null, null, null, "created_at ASC",
        ).use { cursor ->
            val items = ArrayList<QueueItem>(cursor.count)
            while (cursor.moveToNext()) items.add(cursor.toItem())
            items
        }

    fun listByStatus(vararg statuses: QueueStatus): List<QueueItem> {
        val placeholders = statuses.joinToString(",") { "?" }
        return helper.readableDatabase.query(
            "queue", null, "status IN ($placeholders)",
            statuses.map { it.name }.toTypedArray(),
            null, null, "created_at ASC",
        ).use { cursor ->
            val items = ArrayList<QueueItem>(cursor.count)
            while (cursor.moveToNext()) items.add(cursor.toItem())
            items
        }
    }

    /** 最旧的一条可发送条目（补发按 FIFO）。 */
    fun oldestSendable(): QueueItem? =
        helper.readableDatabase.query(
            "queue", null,
            "status IN (?, ?)",
            arrayOf(QueueStatus.PENDING.name, QueueStatus.FAILED.name),
            null, null, "created_at ASC", "1",
        ).use { cursor -> if (cursor.moveToFirst()) cursor.toItem() else null }

    fun countByKindAndStatus(kind: String, statuses: List<QueueStatus>): Int {
        val placeholders = statuses.joinToString(",") { "?" }
        val args = arrayOf(kind) + statuses.map { it.name }.toTypedArray()
        helper.readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM queue WHERE kind = ? AND status IN ($placeholders)",
            args,
        ).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getInt(0) else 0
        }
    }

    /** 事务：先删旧条目，再插入新条目。 */
    fun replaceAll(evictIds: List<String>, item: QueueItem) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            evictIds.forEach { id ->
                db.delete("queue", "id = ?", arrayOf(id))
            }
            db.insertWithOnConflict("queue", null, item.toValues(), SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    // ---------------------------------------------------------------- 映射
    private fun QueueItem.toValues(): ContentValues = ContentValues().apply {
        put("id", id)
        put("kind", kind)
        put("display_name", displayName)
        put("mime", mime)
        put("size", size)
        put("local_path", localPath)
        put("sha256", sha256)
        put("created_at", createdAt)
        put("updated_at", updatedAt)
        put("status", status.name)
        put("attempts", attempts)
        put("last_error", lastError)
        put("expires_at", expiresAt)
        put("upload_id", uploadId)
        put("sent_offset", sentOffset)
        put("target_pc_id", targetPcId)
        put("sent_at", sentAt)
    }

    private fun Cursor.toItem(): QueueItem = QueueItem(
        id = getString(getColumnIndexOrThrow("id")),
        kind = getString(getColumnIndexOrThrow("kind")),
        displayName = getString(getColumnIndexOrThrow("display_name")),
        mime = getString(getColumnIndexOrThrow("mime")),
        size = getLong(getColumnIndexOrThrow("size")),
        localPath = getString(getColumnIndexOrThrow("local_path")),
        sha256 = getString(getColumnIndexOrThrow("sha256")),
        createdAt = getLong(getColumnIndexOrThrow("created_at")),
        updatedAt = getLong(getColumnIndexOrThrow("updated_at")),
        status = QueueStatus.of(getString(getColumnIndexOrThrow("status"))),
        attempts = getInt(getColumnIndexOrThrow("attempts")),
        lastError = getString(getColumnIndexOrThrow("last_error")),
        expiresAt = longOrNull("expires_at"),
        uploadId = getString(getColumnIndexOrThrow("upload_id")),
        sentOffset = getLong(getColumnIndexOrThrow("sent_offset")),
        targetPcId = getString(getColumnIndexOrThrow("target_pc_id")),
        sentAt = longOrNull("sent_at"),
    )

    private fun Cursor.longOrNull(name: String): Long? {
        val index = getColumnIndexOrThrow(name)
        return if (isNull(index)) null else getLong(index)
    }
}
