import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../src/core/config/api_config.dart';
import 'auth_service.dart';
import 'socket_service.dart';

class RuntimeConfigService {
  RuntimeConfigService._internal();
  static final RuntimeConfigService _instance = RuntimeConfigService._internal();
  factory RuntimeConfigService() => _instance;

  static const _cacheKey = 'customer_runtime_config_snapshot';
  static const _cacheTimestampKey = 'customer_runtime_config_snapshot_ts';
  static const Duration _maxCacheAge = Duration(minutes: 15);

  final _configController = StreamController<Map<String, dynamic>>.broadcast();
  Stream<Map<String, dynamic>> get onConfigChanged => _configController.stream;

  Map<String, dynamic>? _snapshot;
  DateTime? _snapshotFetchedAt;
  StreamSubscription<Map<String, dynamic>>? _socketSub;

  Map<String, dynamic>? get snapshot => _snapshot;
  String? get version => _snapshot?['version']?.toString();
  DateTime? get snapshotFetchedAt => _snapshotFetchedAt;
  bool get hasSnapshot => _snapshot != null;
  bool get isStale {
    final fetchedAt = _snapshotFetchedAt;
    if (fetchedAt == null) return true;
    return DateTime.now().difference(fetchedAt) > _maxCacheAge;
  }

  Future<void> initialize() async {
    await _restoreCache();
    _socketSub ??= SocketService().onConfigUpdated.listen((payload) async {
      final snapshot = payload['snapshot'];
      if (snapshot is Map) {
        _snapshot = Map<String, dynamic>.from(snapshot.cast<String, dynamic>());
        _snapshotFetchedAt = DateTime.now();
        await _persistCache();
        _configController.add(_snapshot!);
      } else {
        await refresh();
      }
    });
  }

  Future<void> refresh() async {
    await initialize();
    final token = await AuthService.getToken() ?? '';
    if (token.isEmpty) return;

    final response = await http.get(
      Uri.parse(ApiConfig.runtimeConfig),
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 300) return;
    final body = jsonDecode(response.body);
    final data = body is Map<String, dynamic> ? body['data'] : null;
    if (data is Map<String, dynamic>) {
      _snapshot = data;
      _snapshotFetchedAt = DateTime.now();
      await _persistCache();
      _configController.add(_snapshot!);
    }
  }

  bool boolValue(String key, {bool defaultValue = false}) {
    final dynamic value = (_snapshot?['effectiveConfig']?['global'] as Map?)?[key];
    if (value is bool) return value;
    if (value is String) {
      final lower = value.toLowerCase();
      if (['true', '1', 'yes', 'on', 'enabled', 'active'].contains(lower)) return true;
      if (['false', '0', 'no', 'off', 'disabled', 'inactive'].contains(lower)) return false;
    }
    return defaultValue;
  }

  dynamic scopedValue({
    required String key,
    String? cityKey,
    String? serviceKey,
    String? vehicleKey,
    dynamic defaultValue,
  }) {
    final effective = _snapshot?['effectiveConfig'];
    if (effective is! Map) return defaultValue;

    final global = (effective['global'] as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    dynamic value = global.containsKey(key) ? global[key] : defaultValue;

    if (cityKey != null && cityKey.trim().isNotEmpty) {
      final city = ((effective['city'] as Map?)?[cityKey.trim().toLowerCase()] as Map?)?.cast<String, dynamic>();
      if (city != null && city.containsKey(key)) value = city[key];
    }
    if (serviceKey != null && serviceKey.trim().isNotEmpty) {
      final service = ((effective['service'] as Map?)?[serviceKey.trim().toLowerCase()] as Map?)?.cast<String, dynamic>();
      if (service != null && service.containsKey(key)) value = service[key];
    }
    if (vehicleKey != null && vehicleKey.trim().isNotEmpty) {
      final vehicle = ((effective['vehicle'] as Map?)?[vehicleKey.trim().toLowerCase()] as Map?)?.cast<String, dynamic>();
      if (vehicle != null && vehicle.containsKey(key)) value = vehicle[key];
    }
    return value;
  }

  bool isServiceEnabled(String serviceKey, {bool defaultValue = true}) {
    final normalized = serviceKey.trim().toLowerCase();
    if (normalized.isEmpty) return defaultValue;
    final serviceSpecific = scopedValue(
      key: '${normalized}_enabled',
      serviceKey: normalized,
      defaultValue: null,
    );
    final parsedSpecific = _parseBool(serviceSpecific);
    if (parsedSpecific != null) return parsedSpecific;

    final fallbackMap = <String, String>{
      'ride': 'rides_enabled',
      'rides': 'rides_enabled',
      'parcel': 'parcel_enabled',
      'cargo': 'parcel_enabled',
      'pool': 'pool_enabled',
      'local_pool': 'pool_enabled',
      'outstation_pool': 'pool_enabled',
      'subscriptions': 'subscriptions_enabled',
    };
    final key = fallbackMap[normalized];
    if (key == null) return defaultValue;
    return boolValue(key, defaultValue: defaultValue);
  }

  bool isVehicleEnabled(String vehicleKey, {bool defaultValue = true}) {
    final normalized = vehicleKey.trim().toLowerCase();
    if (normalized.isEmpty) return defaultValue;
    final vehicleSpecific = scopedValue(
      key: 'enabled',
      vehicleKey: normalized,
      defaultValue: null,
    );
    final parsedSpecific = _parseBool(vehicleSpecific);
    if (parsedSpecific != null) return parsedSpecific;
    return defaultValue;
  }

  num numericValue(String key, {num defaultValue = 0}) {
    final value = scopedValue(key: key, defaultValue: defaultValue);
    if (value is num) return value;
    return num.tryParse(value?.toString() ?? '') ?? defaultValue;
  }

  bool? _parseBool(dynamic value) {
    if (value is bool) return value;
    if (value is String) {
      final lower = value.toLowerCase();
      if (['true', '1', 'yes', 'on', 'enabled', 'active'].contains(lower)) return true;
      if (['false', '0', 'no', 'off', 'disabled', 'inactive'].contains(lower)) return false;
    }
    if (value is num) return value != 0;
    return null;
  }

  Future<void> _restoreCache() async {
    if (_snapshot != null) return;
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_cacheKey);
    if (raw == null || raw.isEmpty) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        _snapshot = decoded;
        final ts = prefs.getString(_cacheTimestampKey);
        _snapshotFetchedAt = ts == null ? null : DateTime.tryParse(ts);
      }
    } catch (_) {}
  }

  Future<void> _persistCache() async {
    final snapshot = _snapshot;
    if (snapshot == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_cacheKey, jsonEncode(snapshot));
    await prefs.setString(_cacheTimestampKey, (_snapshotFetchedAt ?? DateTime.now()).toIso8601String());
  }

  Future<void> dispose() async {
    await _socketSub?.cancel();
    _socketSub = null;
  }
}
