package com.mindwhile.jago_pilot

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val overlayChannelName = "com.mindwhile.jago_pilot/overlay"
    private val onlineChannelName = "com.mindwhile.jago_pilot/online"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            val appInfo = packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
            val apiKey = appInfo.metaData?.getString("com.google.android.geo.API_KEY")
            Log.i(
                "MAP_DIAG",
                "driver package=$packageName hasMapsKey=${!apiKey.isNullOrBlank()} keySuffix=${apiKey?.takeLast(6) ?: "missing"}",
            )
        } catch (e: Exception) {
            Log.e("MAP_DIAG", "driver failed to read maps meta-data", e)
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, overlayChannelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "showBubble" -> {
                        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
                            val intent = Intent(this, OverlayBubbleService::class.java)
                                .setAction(OverlayBubbleService.ACTION_SHOW)
                            androidx.core.content.ContextCompat.startForegroundService(this, intent)
                            result.success(true)
                        } else {
                            result.success(false)
                        }
                    }
                    "hideBubble" -> {
                        stopService(Intent(this, OverlayBubbleService::class.java))
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, onlineChannelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "startKeepAlive" -> {
                        val intent = Intent(this, OnlineKeepAliveService::class.java)
                        androidx.core.content.ContextCompat.startForegroundService(this, intent)
                        result.success(true)
                    }
                    "stopKeepAlive" -> {
                        stopService(Intent(this, OnlineKeepAliveService::class.java))
                        result.success(true)
                    }
                    "isIgnoringBatteryOptimizations" -> {
                        val pm = getSystemService(POWER_SERVICE) as PowerManager
                        result.success(pm.isIgnoringBatteryOptimizations(packageName))
                    }
                    "requestIgnoreBatteryOptimizations" -> {
                        try {
                            val intent = Intent(
                                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                Uri.parse("package:$packageName")
                            )
                            startActivity(intent)
                            result.success(true)
                        } catch (e: Exception) {
                            result.success(false)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onResume() {
        super.onResume()
        // Defensive: the app is foreground now, the bubble must never be visible here
        // regardless of whether the Dart-side lifecycle hook already fired.
        try {
            stopService(Intent(this, OverlayBubbleService::class.java))
        } catch (_: Exception) {
        }
    }
}
