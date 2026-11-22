package com.tea.a2share.data

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * 队列数据库（DESIGN.md §6.2）。
 *
 * 只有一张队列表 + 一张 PC 表；用框架 SQLite，不引 Room（省掉 KSP 与版本对齐风险）。
 */
class DbHelper(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "a2_share.db", null, VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE queue (
              id           TEXT PRIMARY KEY,
              kind         TEXT NOT NULL,
              display_name TEXT NOT NULL,
              mime         TEXT,
              size         INTEGER NOT NULL,
              local_path   TEXT,
              sha256       TEXT,
              created_at   INTEGER NOT NULL,
              updated_at   INTEGER NOT NULL,
              status       TEXT NOT NULL,
              attempts     INTEGER NOT NULL DEFAULT 0,
              last_error   TEXT,
              expires_at   INTEGER,
              upload_id    TEXT,
              sent_offset  INTEGER NOT NULL DEFAULT 0,
              target_pc_id TEXT,
              sent_at      INTEGER
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX idx_queue_status_created ON queue(status, created_at)")
        db.execSQL("CREATE INDEX idx_queue_kind_status ON queue(kind, status)")
        db.execSQL(
            """
            CREATE TABLE pc (
              id        TEXT PRIMARY KEY,
              name      TEXT,
              base_url  TEXT,
              token     TEXT,
              session   TEXT,
              paired_at INTEGER,
              last_ok_at INTEGER,
              wifi_handle TEXT
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // v1 只有一个版本；以后加字段走这里（DESIGN.md §3.2 预留迁移位）
    }

    companion object {
        const val VERSION = 1
    }
}
