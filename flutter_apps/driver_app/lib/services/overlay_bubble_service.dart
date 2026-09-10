import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import '../widgets/floating_icon_permission_sheet.dart';

/// Controls the native floating Jago icon shown over other apps while a
/// ride/parcel is active and the app is backgrounded. Pure UI mirror — holds
/// no ride state, so screens are responsible for calling [show]/[hide] at the
/// right lifecycle points.
class OverlayBubbleService {
  static const _channel = MethodChannel('com.mindwhile.jago_pilot/overlay');
  static bool _promptedThisSession = false;

  static Future<bool> hasPermission() async {
    if (!Platform.isAndroid) return false;
    try {
      return await Permission.systemAlertWindow.isGranted;
    } catch (_) {
      return false;
    }
  }

  /// Shows the rationale sheet once per app session if permission isn't
  /// already granted. The driver must explicitly tap "Allow Floating Icon" —
  /// nothing is requested silently. Safe to call from initState via a
  /// post-frame callback.
  static Future<void> maybePromptForPermission(BuildContext context) async {
    if (!Platform.isAndroid || _promptedThisSession) return;
    if (await hasPermission()) return;
    _promptedThisSession = true;
    if (!context.mounted) return;
    await FloatingIconPermissionSheet.show(
      context,
      onAllow: () => _requestAndRecheck(context),
    );
  }

  static Future<void> _requestAndRecheck(BuildContext context) async {
    try {
      await Permission.systemAlertWindow.request();
    } catch (_) {}
    // The driver just returned from Settings — check whether it actually took.
    final granted = await hasPermission();
    if (!granted && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            "Still blocked? On some phones you also need to enable "
            "'Allow restricted settings' for JAGO Pilot first — tap the ⋮ "
            "menu on the app's Settings page, then try again.",
          ),
          duration: Duration(seconds: 6),
        ),
      );
    }
  }

  static Future<void> show() async {
    if (!Platform.isAndroid) return;
    try {
      if (!await hasPermission()) return;
      await _channel.invokeMethod('showBubble');
    } catch (_) {}
  }

  static Future<void> hide() async {
    if (!Platform.isAndroid) return;
    try {
      await _channel.invokeMethod('hideBubble');
    } catch (_) {}
  }
}
