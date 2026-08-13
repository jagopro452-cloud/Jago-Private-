package com.mindwhile.jago_pilot

import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
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
}
