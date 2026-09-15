import 'package:shared_preferences/shared_preferences.dart';

/// Client-side mirror of server/service-eligibility.ts — a defense-in-depth
/// safety net on top of server-side dispatch filtering. The server never
/// targets an ineligible driver's socket room or FCM token in the first
/// place, so this only matters if a stray/misrouted event ever arrives; it
/// must never be the only gate.
///
/// The one approved cross-service exception: a driver registered for normal
/// Ride Service under the Bike category also receives Parcel alerts. No
/// other Ride vehicle (Auto, Cab, Sedan, Mini, SUV/XL) does, and no
/// Parcel-registered vehicle ever receives Ride alerts.
class DriverEligibility {
  static const _serviceTypeKey = 'driver_service_type';
  static const _vehicleTypeKey = 'driver_vehicle_type_slug';

  static const _bikeSynonyms = {
    'bike',
    'bike_ride',
    'motor_bike',
    'motorbike',
    'motor_cycle',
    'motorcycle',
    'two_wheeler',
    'two_wheel',
  };

  /// Call after every successful dashboard/profile fetch so the cached
  /// values never go stale across a Ride↔Parcel re-registration.
  static Future<void> cache({required String serviceType, String? vehicleType}) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_serviceTypeKey, serviceType.toLowerCase());
      await prefs.setString(_vehicleTypeKey, (vehicleType ?? '').toLowerCase());
    } catch (_) {}
  }

  static Future<(String serviceType, String vehicleType)> _readCached() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return (
        (prefs.getString(_serviceTypeKey) ?? 'ride').toLowerCase(),
        (prefs.getString(_vehicleTypeKey) ?? '').toLowerCase(),
      );
    } catch (_) {
      return ('ride', '');
    }
  }

  static bool _isBike(String vehicleType) => _bikeSynonyms.contains(vehicleType.trim().toLowerCase());

  /// Returns true if this driver should be shown an alert for [bookingServiceType]
  /// ('ride' or 'parcel'). An alert with no/unknown serviceType is always
  /// shown — this check only ever hides an alert it can positively rule out,
  /// never withholds one it's unsure about.
  static Future<bool> canReceive(String? bookingServiceType) async {
    final normalized = (bookingServiceType ?? '').trim().toLowerCase();
    if (normalized.isEmpty) return true;
    final (driverServiceType, driverVehicleType) = await _readCached();
    if (normalized == 'ride') {
      return driverServiceType == 'ride';
    }
    if (normalized == 'parcel') {
      if (driverServiceType == 'parcel') return true;
      return driverServiceType == 'ride' && _isBike(driverVehicleType);
    }
    return true;
  }
}
