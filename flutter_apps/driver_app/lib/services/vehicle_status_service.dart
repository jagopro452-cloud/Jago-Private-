import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/api_config.dart';

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
