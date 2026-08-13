import 'package:jago_shared_core/jago_shared_core.dart';

/// Thin app-local wrapper: generation logic lives in the shared package
/// (DeviceIdGenerator). 'drv' prefix and 'device_id' storage key preserved
/// exactly as before, so existing installs keep their existing device ID.
class DeviceIdentityService {
  static Future<String> getDeviceId() {
    return DeviceIdGenerator.generate(prefix: 'drv');
  }
}
