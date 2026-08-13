import 'dart:math';
import 'package:shared_preferences/shared_preferences.dart';

/// Generates and persists a stable, per-install device identifier.
///
/// Extracted from customer_app/driver_app's near-identical
/// `device_identity_service.dart` (they differed only in the ID prefix and
/// were otherwise byte-for-byte the same). [prefix] and [storageKey]
/// preserve each app's existing values exactly, so already-installed apps
/// keep generating/reading the same device ID they always have — no
/// behavior change for existing users.
class DeviceIdGenerator {
  const DeviceIdGenerator._();

  static Future<String> generate({
    required String prefix,
    String storageKey = 'device_id',
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(storageKey)?.trim() ?? '';
    if (existing.isNotEmpty) return existing;

    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    final deviceId = '$prefix-$hex';
    await prefs.setString(storageKey, deviceId);
    return deviceId;
  }
}
