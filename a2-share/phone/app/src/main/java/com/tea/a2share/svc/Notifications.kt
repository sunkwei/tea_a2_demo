package com.tea.a2share.svc

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.tea.a2share.R
import com.tea.a2share.ui.MainActivity

/** 通知渠道与构建（需求 FR-P18）。 */
object Notifications {

    const val CHANNEL_TRANSFER = "transfer"
    const val CHANNEL_CONNECTION = "connection"
    const val CHANNEL_ALERT = "alert"

    const val ID_FOREGROUND = 1001
    const val ID_TRANSFER = 1002
    const val ID_CONNECTION = 1003
    const val ID_ALERT = 1004

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_TRANSFER,
                context.getString(R.string.channel_transfer),
                NotificationManager.IMPORTANCE_LOW,
            )
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_CONNECTION,
                context.getString(R.string.channel_connection),
                NotificationManager.IMPORTANCE_LOW,
            )
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ALERT,
                context.getString(R.string.channel_alert),
                NotificationManager.IMPORTANCE_DEFAULT,
            )
        )
    }

    fun foreground(context: Context, text: String): Notification {
        ensureChannels(context)
        val pending = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(context, CHANNEL_TRANSFER)
            .setContentTitle(context.getString(R.string.notif_transfer_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pending)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    fun build(
        context: Context,
        channel: String,
        title: String,
        text: String,
        ongoing: Boolean = false,
    ): Notification {
        ensureChannels(context)
        val pending = PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(context, channel)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentIntent(pending)
            .setOngoing(ongoing)
            .setAutoCancel(!ongoing)
            .build()
    }

    fun notify(context: Context, id: Int, notification: Notification) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.notify(id, notification)
    }
}
