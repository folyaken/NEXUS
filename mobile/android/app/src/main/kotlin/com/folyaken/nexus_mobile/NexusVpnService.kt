package com.folyaken.nexus_mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor

/**
 * Заглушка VPN-сервиса.
 *
 * Реальный VPN-движок (sing-box / Xray-core через flutter_v2ray_plus или v2ray_box)
 * приносит собственную реализацию VpnService — этот класс нужен как база для
 * кастомных сценариев (например, маршрутизация только списка сайтов для «Обхода DPI»).
 */
class NexusVpnService : VpnService() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, buildNotification())
        return START_STICKY
    }

    override fun onDestroy() {
        stopForeground(true)
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val channelId = "nexus_vpn"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "NEXUS VPN",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, channelId)
            .setContentTitle("NEXUS VPN")
            .setContentText("Защищённое соединение активно")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(pendingIntent)
            .build()
    }

    @Suppress("unused")
    private fun dummyInterface(): ParcelFileDescriptor? {
        // Здесь строится реальный tun-интерфейс через VpnService.Builder.
        return null
    }
}
