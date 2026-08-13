import 'dart:convert';
import 'package:http/http.dart' as http;
import '../src/core/config/api_config.dart';
import 'auth_service.dart';

Map<String, dynamic> _safeJson(http.Response res) {
  try {
    final ct = res.headers['content-type'] ?? '';
    if (!ct.contains('application/json')) return {'error': 'Invalid server response', 'statusCode': res.statusCode};
    return jsonDecode(res.body) as Map<String, dynamic>;
  } catch (_) {
    return {'error': 'Failed to parse response', 'statusCode': res.statusCode};
  }
}

class TripService {
  static Future<Map<String, dynamic>> estimateFare({
    required double pickupLat,
    required double pickupLng,
    required double destLat,
    required double destLng,
  }) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.estimateFare),
        headers: headers,
        body: jsonEncode({'pickupLat': pickupLat, 'pickupLng': pickupLng, 'destLat': destLat, 'destLng': destLng}));
      return _safeJson(res);
    } catch (e) {
      return {'error': e.toString(), 'fares': []};
    }
  }

  static Future<Map<String, dynamic>> bookRide({
    required String pickupAddress,
    required double pickupLat,
    required double pickupLng,
    required String destAddress,
    required double destLat,
    required double destLng,
    required String vehicleCategoryId,
    required String vehicleType,
    required double estimatedFare,
    required double estimatedDistance,
    required String paymentMethod,
  }) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.bookRide),
        headers: headers,
        body: jsonEncode({
          'pickupAddress': pickupAddress, 'pickupLat': pickupLat, 'pickupLng': pickupLng,
          'destinationAddress': destAddress, 'destinationLat': destLat, 'destinationLng': destLng,
          'vehicleCategoryId': vehicleCategoryId, 'vehicleType': vehicleType, 'estimatedFare': estimatedFare,
          'estimatedDistance': estimatedDistance, 'paymentMethod': paymentMethod,
        }));
      return _safeJson(res);
    } catch (e) {
      return {'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>> getActiveTrip() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.activeTrip), headers: headers);
      return _safeJson(res);
    } catch (_) {
      return {'trip': null};
    }
  }

  static Future<Map<String, dynamic>> getActiveBooking() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.activeBooking), headers: headers);
      return _safeJson(res);
    } catch (_) {
      return {'booking': null, 'bookingType': null};
    }
  }

  static Future<Map<String, dynamic>> trackTrip(String tripId) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse('${ApiConfig.trackTrip}/$tripId'), headers: headers);
      return _safeJson(res);
    } catch (_) {
      return {};
    }
  }

  static Future<Map<String, dynamic>> cancelTrip(String tripId, String reason) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.cancelTrip),
        headers: headers,
        body: jsonEncode({'tripId': tripId, 'reason': reason}));
      return _safeJson(res);
    } catch (e) {
      return {'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>> cancelParcelOrder(String orderId, {String reason = 'Customer cancelled'}) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(ApiConfig.parcelCancel(orderId)),
        headers: headers,
        body: jsonEncode({'reason': reason}),
      );
      return _safeJson(res);
    } catch (e) {
      return {'error': e.toString()};
    }
  }

  static Future<Map<String, dynamic>> rateDriver({required String tripId, required double rating, String? review}) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.rateDriver),
        headers: headers,
        body: jsonEncode({'tripId': tripId, 'rating': rating, 'review': review ?? ''}));
      return _safeJson(res);
    } catch (e) {
      return {'error': e.toString()};
    }
  }

  static Future<List<dynamic>> getTripHistory() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.trips), headers: headers);
      final data = _safeJson(res);
      return (data['trips'] ?? data['data'] ?? []) as List<dynamic>;
    } catch (_) { return []; }
  }

  static Future<Map<String, dynamic>> getWallet() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.wallet), headers: headers);
      return _safeJson(res);
    } catch (_) {
      return {'balance': 0, 'transactions': []};
    }
  }

  static Future<Map<String, dynamic>> rechargeWallet({required double amount, required String paymentRef, String paymentMethod = 'upi'}) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.walletRecharge),
        headers: headers,
        body: jsonEncode({'amount': amount, 'paymentRef': paymentRef, 'paymentMethod': paymentMethod}));
      return _safeJson(res);
    } catch (e) {
      return {'error': e.toString()};
    }
  }

  static Future<List<dynamic>> getSavedPlaces() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.savedPlaces), headers: headers);
      final data = _safeJson(res);
      return (data['data'] ?? []) as List<dynamic>;
    } catch (_) { return []; }
  }

  static Future<Map<String, dynamic>> addSavedPlace({required String label, required String address, required double lat, required double lng}) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.savedPlaces),
        headers: headers,
        body: jsonEncode({'label': label, 'address': address, 'lat': lat, 'lng': lng}));
      return _safeJson(res);
    } catch (e) {
      return {'error': e.toString()};
    }
  }

  static Future<void> deleteSavedPlace(String id) async {
    try {
      final headers = await AuthService.getHeaders();
      await http.delete(Uri.parse('${ApiConfig.savedPlaces}/$id'), headers: headers);
    } catch (_) {}
  }

  static Future<Map<String, dynamic>> applyCoupon({required String code, required double fareAmount}) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.applyCoupon),
        headers: headers,
        body: jsonEncode({'code': code, 'fareAmount': fareAmount}));
      return _safeJson(res);
    } catch (e) {
      return {'error': e.toString()};
    }
  }

  static Future<List<dynamic>> getNearbyDrivers({required double lat, required double lng}) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse('${ApiConfig.nearbyDrivers}?lat=$lat&lng=$lng'), headers: headers);
      final data = _safeJson(res);
      return (data['drivers'] ?? []) as List<dynamic>;
    } catch (_) { return []; }
  }
}
