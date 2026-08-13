import 'dart:convert';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';
import 'auth_service.dart';

class LocationService {
  static Future<bool> requestPermission() async {
    bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return false;

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return permission == LocationPermission.always ||
        permission == LocationPermission.whileInUse;
  }

  static Future<Position?> getCurrentPosition({bool highAccuracy = false}) async {
    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(
          // Use high accuracy only when explicitly needed (first-fix, active trip start)
          accuracy: highAccuracy ? LocationAccuracy.high : LocationAccuracy.medium,
        ),
      );
    } catch (_) {
      return null;
    }
  }

  static Stream<Position> getLocationStream({bool highAccuracy = false}) {
    return Geolocator.getPositionStream(
      locationSettings: LocationSettings(
        // Use medium (cell+WiFi) when idle; high only during active trip
        accuracy: highAccuracy ? LocationAccuracy.high : LocationAccuracy.medium,
        distanceFilter: highAccuracy ? 5 : 20, // 5 m on trip, 20 m when idle
      ),
    );
  }

  static Future<void> updateLocation({
    required double lat,
    required double lng,
    double heading = 0,
    double speed = 0,
    bool isOnline = true,
  }) async {
    try {
      final headers = await AuthService.getHeaders();
      await http.post(
        Uri.parse(ApiConfig.driverLocation),
        headers: headers,
        body: jsonEncode({
          'lat': lat,
          'lng': lng,
          'heading': heading,
          'speed': speed,
          'isOnline': isOnline,
        }),
      );
    } catch (_) {}
  }

  static Future<Map<String, dynamic>> setOnlineStatus(bool isOnline) async {
    final headers = await AuthService.getHeaders();
    final res = await http.patch(
      Uri.parse(ApiConfig.driverOnlineStatus),
      headers: headers,
      body: jsonEncode({'isOnline': isOnline}),
    );
    return jsonDecode(res.body);
  }
}
