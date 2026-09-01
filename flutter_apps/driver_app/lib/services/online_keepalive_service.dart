import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../widgets/battery_optimization_sheet.dart';

/// Keeps the driver app process alive in the background while the online
/// toggle is on (no active ride required) via a native foreground service,
/// so FCM ride/parcel offers reliably reach the app instead of being killed
/// by OEM battery managers. Also offers a one-time battery-optimization
/// exemption prompt for further reliability.
class OnlineKeepAliveService {
  static const _channel = MethodChannel('com.mindwhile.jago_pilot/online');
  static bool _promptedThisSession = false;

  static Future<void> start() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('startKeepAlive');
    } catch (_) {}
  }

  static Future<void> stop() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('stopKeepAlive');
    } catch (_) {}
  }

  /// Shows the rationale sheet once per app session if the exemption isn't
  /// already granted. Safe to call from a post-frame callback.
  static Future<void> maybePromptForBatteryExemption(BuildContext context) async {
    if (!Platform.isAndroid || _promptedThisSession) return;
    try {
      final ignoring = await _channel.invokeMethod<bool>('isIgnoringBatteryOptimizations') ?? true;
      if (ignoring) return;
    } catch (_) {
      return;
    }
    _promptedThisSession = true;
    if (!context.mounted) return;
    await BatteryOptimizationSheet.show(
      context,
      onAllow: () async {
        try {
          await _channel.invokeMethod('requestIgnoreBatteryOptimizations');
        } catch (_) {}
      },
    );
  }
}
