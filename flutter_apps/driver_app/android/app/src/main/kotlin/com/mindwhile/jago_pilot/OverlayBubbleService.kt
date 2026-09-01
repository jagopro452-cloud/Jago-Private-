package com.mindwhile.jago_pilot

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.app.NotificationCompat
import kotlin.math.abs

/**
 * Draggable "Jago" icon-only bubble shown over other apps while a ride/parcel
 * is active and the app is backgrounded. Purely a UI mirror driven by Dart —
 * it holds no ride state itself, so it is safe to kill/restart at any time.
 */
class OverlayBubbleService : Service() {

    companion object {
        private const val TAG = "OverlayBubbleService"
        const val ACTION_SHOW = "com.mindwhile.jago_pilot.action.SHOW_BUBBLE"
        private const val NOTIFICATION_CHANNEL_ID = "jago_ride_overlay"
        private const val NOTIFICATION_ID = 7821
        private const val BUBBLE_SIZE_DP = 52
        private const val ICON_SIZE_DP = 30
        private const val TAP_SLOP_PX = 16
    }

    private var windowManager: WindowManager? = null
    private var bubbleView: View? = null
    private var layoutParams: WindowManager.LayoutParams? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_SHOW || intent == null) {
            showBubble()
        }
        return START_NOT_STICKY
    }

    private fun dpToPx(dp: Int): Int =
        (dp * resources.displayMetrics.density).toInt()

    private fun showBubble() {
        if (bubbleView != null) return // already showing — avoid duplicates

        if (!Settings.canDrawOverlays(this)) {
            Log.w(TAG, "Overlay permission not granted, stopping")
            stopSelf()
            return
        }

        startForegroundCompat()

        try {
            windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

            val bubble = FrameLayout(this).apply {
                background = androidx.core.content.ContextCompat.getDrawable(
                    this@OverlayBubbleService, R.drawable.bubble_circle_bg
                )
                elevation = dpToPx(6).toFloat()
                outlineProvider = ViewOutlineProvider.BACKGROUND
                clipToOutline = true
            }
            val icon = ImageView(this).apply {
                setImageResource(R.mipmap.ic_launcher)
                val size = dpToPx(ICON_SIZE_DP)
                layoutParams = FrameLayout.LayoutParams(size, size, Gravity.CENTER)
            }
            bubble.addView(icon)

            val overlayType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            } else {
                @Suppress("DEPRECATION")
                WindowManager.LayoutParams.TYPE_PHONE
            }

            val size = dpToPx(BUBBLE_SIZE_DP)
            val params = WindowManager.LayoutParams(
                size,
                size,
                overlayType,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT
            )
            params.gravity = Gravity.TOP or Gravity.START
            params.x = resources.displayMetrics.widthPixels - size - dpToPx(8)
            params.y = resources.displayMetrics.heightPixels / 3

            attachDragAndTapHandling(bubble, params)

            windowManager?.addView(bubble, params)
            bubbleView = bubble
            layoutParams = params
        } catch (e: Exception) {
            Log.e(TAG, "Failed to add bubble overlay", e)
            stopSelf()
        }
    }

    private fun attachDragAndTapHandling(view: View, params: WindowManager.LayoutParams) {
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var totalMovement = 0f

        view.setOnTouchListener { v, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    totalMovement = 0f
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - initialTouchX
                    val dy = event.rawY - initialTouchY
                    totalMovement = abs(dx) + abs(dy)
                    params.x = initialX + dx.toInt()
                    params.y = initialY + dy.toInt()
                    try {
                        windowManager?.updateViewLayout(v, params)
                    } catch (_: Exception) {
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (totalMovement < TAP_SLOP_PX) {
                        onBubbleTapped()
                    } else {
                        snapToEdge(v, params)
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun snapToEdge(view: View, params: WindowManager.LayoutParams) {
        val screenWidth = resources.displayMetrics.widthPixels
        val bubbleSize = view.width.takeIf { it > 0 } ?: dpToPx(BUBBLE_SIZE_DP)
        val margin = dpToPx(8)
        val targetX = if (params.x + bubbleSize / 2 < screenWidth / 2) {
            margin
        } else {
            screenWidth - bubbleSize - margin
        }
        params.x = targetX
        try {
            windowManager?.updateViewLayout(view, params)
        } catch (_: Exception) {
        }
    }

    private fun onBubbleTapped() {
        try {
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            launchIntent?.addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            )
            if (launchIntent != null) startActivity(launchIntent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to bring app to front", e)
        }
    }

    private fun startForegroundCompat() {
        val channelManager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val existing = channelManager.getNotificationChannel(NOTIFICATION_CHANNEL_ID)
            if (existing == null) {
                val channel = NotificationChannel(
                    NOTIFICATION_CHANNEL_ID,
                    "Ride in progress",
                    NotificationManager.IMPORTANCE_MIN
                ).apply {
                    setShowBadge(false)
                    enableLights(false)
                    enableVibration(false)
                }
                channelManager.createNotificationChannel(channel)
            }
        }

        val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            PendingIntent.getActivity(
                this, 0, it,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        val notification = NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("JAGO Pilot")
            .setContentText("Ride in progress")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(contentIntent)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, 0)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun removeBubble() {
        try {
            bubbleView?.let { windowManager?.removeView(it) }
        } catch (_: Exception) {
        }
        bubbleView = null
        layoutParams = null
        windowManager = null
    }

    override fun onDestroy() {
        removeBubble()
        super.onDestroy()
    }
}
