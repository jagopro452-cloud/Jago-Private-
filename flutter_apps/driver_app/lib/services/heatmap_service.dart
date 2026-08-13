import 'dart:async';
import 'dart:convert';
import 'dart:math' show sqrt, cos, pi;
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import '../config/api_config.dart';
import 'auth_service.dart';

// Demand level colors
const Color kHeatLow    = Color(0xFF22C55E); // green
const Color kHeatMedium = Color(0xFFF59E0B); // yellow/amber
const Color kHeatHigh   = Color(0xFFEF4444); // red

class HeatmapZone {
  final String key;
  final double lat;
  final double lng;
  final int requestCount;
  final int activeDrivers;
  final double demandScore;
  final String demandLevel; // low | medium | high
  final Map<String, int> serviceBreakdown;
  final int earningMin;
  final int earningMax;

  const HeatmapZone({
    required this.key,
    required this.lat,
    required this.lng,
    required this.requestCount,
    required this.activeDrivers,
    required this.demandScore,
    required this.demandLevel,
    required this.serviceBreakdown,
    required this.earningMin,
    required this.earningMax,
  });

  factory HeatmapZone.fromJson(Map<String, dynamic> j) => HeatmapZone(
    key: j['key']?.toString() ?? '',
    lat: (j['lat'] ?? 0).toDouble(),
    lng: (j['lng'] ?? 0).toDouble(),
    requestCount: (j['requestCount'] ?? 0) as int,
    activeDrivers: (j['activeDrivers'] ?? 0) as int,
    demandScore: (j['demandScore'] ?? 0).toDouble(),
    demandLevel: j['demandLevel']?.toString() ?? 'low',
    serviceBreakdown: Map<String, int>.from(
      (j['serviceBreakdown'] as Map? ?? {}).map((k, v) => MapEntry(k.toString(), (v ?? 0) as int))
    ),
    earningMin: (j['earningMin'] ?? 0) as int,
    earningMax: (j['earningMax'] ?? 0) as int,
  );

  Color get color {
    switch (demandLevel) {
      case 'high':   return kHeatHigh;
      case 'medium': return kHeatMedium;
      default:       return kHeatLow;
    }
  }

  double get radiusMeters {
    // Visual radius slightly larger for high demand zones
    switch (demandLevel) {
      case 'high':   return 380;
      case 'medium': return 300;
      default:       return 220;
    }
  }
}

class HeatmapSuggestion {
  final double lat;
  final double lng;
  final double distanceKm;
  final String demandLevel;
  final int earningMin;
  final int earningMax;
  final String topService;
  final String message;
  final String detail;

  const HeatmapSuggestion({
    required this.lat,
    required this.lng,
    required this.distanceKm,
    required this.demandLevel,
    required this.earningMin,
    required this.earningMax,
    required this.topService,
    required this.message,
    required this.detail,
  });

  factory HeatmapSuggestion.fromJson(Map<String, dynamic> j) => HeatmapSuggestion(
    lat: (j['lat'] ?? 0).toDouble(),
    lng: (j['lng'] ?? 0).toDouble(),
    distanceKm: (j['distanceKm'] ?? 0).toDouble(),
    demandLevel: j['demandLevel']?.toString() ?? 'medium',
    earningMin: (j['earningMin'] ?? 0) as int,
    earningMax: (j['earningMax'] ?? 0) as int,
    topService: j['topService']?.toString() ?? 'ride',
    message: j['message']?.toString() ?? '',
    detail: j['detail']?.toString() ?? '',
  );
}

class HeatmapService {
  static final HeatmapService _instance = HeatmapService._internal();
  factory HeatmapService() => _instance;
  HeatmapService._internal();

  List<HeatmapZone> _zones = [];
  HeatmapSuggestion? _suggestion;
  bool _isActive = true;
  int _idleTimeoutMinutes = 5;
  int _refreshIntervalSeconds = 30;

  Timer? _refreshTimer;
  bool _isFetching = false;

  List<HeatmapZone> get zones => List.unmodifiable(_zones);
  HeatmapSuggestion? get suggestion => _suggestion;
  bool get isActive => _isActive;
  int get idleTimeoutMinutes => _idleTimeoutMinutes;

  /// Start periodic heatmap refresh. Call when driver goes online.
  void startRefresh(double lat, double lng, {VoidCallback? onUpdate}) {
    _refreshTimer?.cancel();
    _fetchZones(lat, lng, onUpdate: onUpdate);
    _refreshTimer = Timer.periodic(
      Duration(seconds: _refreshIntervalSeconds),
      (_) => _fetchZones(lat, lng, onUpdate: onUpdate),
    );
  }

  /// Stop refresh timer. Call when driver goes offline.
  void stopRefresh() {
    _refreshTimer?.cancel();
    _refreshTimer = null;
    _zones = [];
    _suggestion = null;
  }

  /// One-shot refresh with updated driver position.
  void updatePosition(double lat, double lng, {VoidCallback? onUpdate}) {
    if (_refreshTimer == null) {
      startRefresh(lat, lng, onUpdate: onUpdate);
    } else {
      _fetchZones(lat, lng, onUpdate: onUpdate);
    }
  }

  Future<void> _fetchZones(double lat, double lng, {VoidCallback? onUpdate}) async {
    if (_isFetching) return;
    _isFetching = true;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse(ApiConfig.driverHeatmap(lat: lat, lng: lng, radius: 12)),
        headers: headers,
      ).timeout(const Duration(seconds: 8));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        _isActive = data['isActive'] != false;
        _idleTimeoutMinutes = (data['idleTimeoutMinutes'] ?? 5) as int;
        _refreshIntervalSeconds = (data['refreshIntervalSeconds'] ?? 30) as int;

        if (_isActive) {
          final zoneList = (data['zones'] as List? ?? []);
          _zones = zoneList.map((z) => HeatmapZone.fromJson(z as Map<String, dynamic>)).toList();
        } else {
          _zones = [];
        }
        onUpdate?.call();
      }
    } catch (_) {}
    _isFetching = false;
  }

  Future<HeatmapSuggestion?> fetchSuggestion(double lat, double lng) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse(ApiConfig.driverHeatmapSuggestion(lat: lat, lng: lng)),
        headers: headers,
      ).timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        if (data['suggestion'] != null) {
          _suggestion = HeatmapSuggestion.fromJson(data['suggestion'] as Map<String, dynamic>);
          return _suggestion;
        }
      }
    } catch (_) {}
    _suggestion = null;
    return null;
  }

  /// Build Google Maps Circle overlays from current zones.
  Set<Circle> buildCircles() {
    if (!_isActive || _zones.isEmpty) return {};
    return _zones.map((z) => Circle(
      circleId: CircleId('heatmap_${z.key}'),
      center: LatLng(z.lat, z.lng),
      radius: z.radiusMeters,
      fillColor: z.color.withValues(alpha: 0.28),
      strokeColor: z.color.withValues(alpha: 0.65),
      strokeWidth: 1,
      consumeTapEvents: false,
    )).toSet();
  }

  /// Nearest high/medium zone to driver position (for suggestion banner).
  HeatmapZone? nearestHighDemand(double driverLat, double driverLng) {
    HeatmapZone? best;
    double bestDist = double.infinity;
    for (final z in _zones) {
      if (z.demandLevel == 'low' && z.demandScore < 1.0) continue;
      final dLat = (z.lat - driverLat) * 111.32;
      final dLng = (z.lng - driverLng) * 111.32 * cos(driverLat * pi / 180);
      final dist = sqrt(dLat * dLat + dLng * dLng);
      if (dist < bestDist) { bestDist = dist; best = z; }
    }
    return best;
  }

  void dispose() {
    stopRefresh();
  }
}
