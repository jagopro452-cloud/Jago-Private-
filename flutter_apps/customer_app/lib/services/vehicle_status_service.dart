import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../src/core/config/api_config.dart';

class VehicleStatus {
  final String key;
  final String name;
  final bool active;
  final DateTime? updatedAt;

  const VehicleStatus({
    required this.key,
    required this.name,
    required this.active,
    this.updatedAt,
  });

  factory VehicleStatus.fromJson(Map<String, dynamic> json) {
    return VehicleStatus(
      key: json['key']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      active: json['active'] == true,
      updatedAt: DateTime.tryParse(json['updatedAt']?.toString() ?? ''),
    );
  }
}

class VehicleStatusService {
  static const List<VehicleStatus> fallbackStatuses = [
    VehicleStatus(key: 'bike', name: 'Bike', active: true),
    VehicleStatus(key: 'auto', name: 'Auto', active: true),
    VehicleStatus(key: 'cab', name: 'Cab', active: true),
    VehicleStatus(key: 'premium', name: 'Premium', active: true),
    VehicleStatus(key: 'bike_parcel', name: 'Bike Parcel', active: true),
    VehicleStatus(key: 'auto_parcel', name: 'Auto Parcel', active: true),
    VehicleStatus(key: 'tata_ace', name: 'Tata Ace', active: true),
    VehicleStatus(key: 'pickup_truck', name: 'Pickup Truck', active: true),
    VehicleStatus(key: 'bolero_cargo', name: 'Bolero Cargo', active: true),
    VehicleStatus(key: 'tempo_407', name: 'Tempo 407', active: true),
    VehicleStatus(key: 'local_pool', name: 'Local Pool', active: true),
    VehicleStatus(key: 'outstation_pool', name: 'Outstation Pool', active: true),
  ];

  Stream<Map<String, VehicleStatus>> watchVehicleStatuses() async* {
    yield await fetchVehicleStatuses();
    yield* Stream.periodic(const Duration(seconds: 3))
        .asyncMap((_) => fetchVehicleStatuses());
  }

  Future<Map<String, VehicleStatus>> fetchVehicleStatuses() async {
    final fallback = {for (final status in fallbackStatuses) status.key: status};
    try {
      final res = await http
          .get(Uri.parse('${ApiConfig.baseUrl}/api/app/vehicle-status'))
          .timeout(const Duration(seconds: 4));
      if (res.statusCode != 200) return fallback;
      final data = jsonDecode(res.body);
      final list = data['vehicles'] is List ? data['vehicles'] as List : const [];
      final statuses = Map<String, VehicleStatus>.from(fallback);
      for (final item in list) {
        if (item is Map<String, dynamic>) {
          final status = VehicleStatus.fromJson(item);
          if (status.key.isNotEmpty) statuses[status.key] = status;
        } else if (item is Map) {
          final status = VehicleStatus.fromJson(Map<String, dynamic>.from(item));
          if (status.key.isNotEmpty) statuses[status.key] = status;
        }
      }
      return statuses;
    } catch (_) {
      return fallback;
    }
  }

  static String keyForVehicleName(String value) {
    final name = value.toLowerCase();
    if (name.contains('bike') && name.contains('parcel')) return 'bike_parcel';
    if (name.contains('auto') && name.contains('parcel')) return 'auto_parcel';
    if (name.contains('mini') && name.contains('truck')) return 'tata_ace';
    if (name.contains('tata') && name.contains('ace')) return 'tata_ace';
    if (name.contains('bolero')) return 'bolero_cargo';
    if (name.contains('tempo') || name.contains('407')) return 'tempo_407';
    if (name.contains('pickup')) return 'pickup_truck';
    if (name.contains('outstation') && name.contains('pool')) return 'outstation_pool';
    if ((name.contains('local') || name.contains('city') || name.contains('carpool')) &&
        name.contains('pool')) {
      return 'local_pool';
    }
    if (name.contains('bike')) return 'bike';
    if (name.contains('auto')) return 'auto';
    if (name.contains('premium')) return 'premium';
    if (name.contains('cab') ||
        name.contains('car') ||
        name.contains('sedan') ||
        name.contains('suv') ||
        name.contains('mini')) {
      return 'cab';
    }
    return '';
  }

  static bool isActive(Map<String, VehicleStatus> statuses, String vehicleName) {
    final key = keyForVehicleName(vehicleName);
    if (key.isEmpty) return true;
    return statuses[key]?.active ?? true;
  }
}
