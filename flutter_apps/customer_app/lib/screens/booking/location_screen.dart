import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shimmer/shimmer.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import 'booking_screen.dart';
import 'map_location_picker.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Jago — Full-Screen Location Picker
// Rule 1: Location ALWAYS comes before vehicle selection.
// Rule 7: Pickup auto-detect · Drop auto-focus · Map pick · Add stop · Suggestions
// ─────────────────────────────────────────────────────────────────────────────

class LocationScreen extends StatefulWidget {
  final String serviceType; // 'ride' or 'parcel'
  final String? pickupAddress;
  final double pickupLat;
  final double pickupLng;
  final String? vehicleCategoryId;
  final String? vehicleCategoryName;

  const LocationScreen({
    super.key,
    required this.serviceType,
    this.pickupAddress,
    this.pickupLat = 0.0,
    this.pickupLng = 0.0,
    this.vehicleCategoryId,
    this.vehicleCategoryName,
  });

  @override
  State<LocationScreen> createState() => _LocationScreenState();
}

class _LocationScreenState extends State<LocationScreen>
    with TickerProviderStateMixin {
  // ── Controllers ──────────────────────────────────────────────────────────
  final _dropCtrl = TextEditingController();
  final _stopCtrl = TextEditingController();
  final FocusNode _dropFocus = FocusNode();
  final FocusNode _stopFocus = FocusNode();

  // ── State ─────────────────────────────────────────────────────────────────
  String _pickup = '';
  double _pickupLat = 0.0;
  double _pickupLng = 0.0;

  String _drop = '';
  double _dropLat = 0.0;
  double _dropLng = 0.0;

  bool _showStop = false;

  bool _detectingLocation = false;
  List<Map<String, dynamic>> _searchResults = [];
  List<Map<String, dynamic>> _recent = [];
  bool _loadingExactPoints = false;
  bool _searching = false;
  bool _activeField = true; // true = editing drop, false = editing stop
  String _activeQuery = '';
  Timer? _debounce;
  String _sessionToken = ''; // Google Places Session Token for cost optimization
  int _searchRequestSeq = 0;

  // ── Animation ─────────────────────────────────────────────────────────────
  late AnimationController _slideCtrl;
  late Animation<Offset> _slideAnim;

  // ── Theme ─────────────────────────────────────────────────────────────────
  bool get _isParcel => widget.serviceType == 'parcel';
  Color get _accent => _isParcel ? const Color(0xFFEA580C) : JT.primary;
  Color get _accentLight =>
      _isParcel ? const Color(0xFFFFF7ED) : const Color(0xFFF0F7FF);

  @override
  void initState() {
    super.initState();
    _pickup = widget.pickupAddress ?? '';
    _pickupLat = widget.pickupLat;
    _pickupLng = widget.pickupLng;

    _slideCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 350));
    _slideAnim = Tween<Offset>(
            begin: const Offset(0, 0.4), end: Offset.zero)
        .animate(
            CurvedAnimation(parent: _slideCtrl, curve: Curves.easeOutCubic));
    _slideCtrl.forward();

    _loadRecent();
    _resetSessionToken();
    if (_pickup.isEmpty) _detectLocation();

    // Auto-focus drop field
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _dropFocus.requestFocus();
    });
  }

  @override
  void dispose() {
    _dropCtrl.dispose();
    _stopCtrl.dispose();
    _dropFocus.dispose();
    _stopFocus.dispose();
    _debounce?.cancel();
    _slideCtrl.dispose();
    super.dispose();
  }

  // ── Location Detection ────────────────────────────────────────────────────
  Future<void> _detectLocation() async {
    setState(() => _detectingLocation = true);
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (!serviceEnabled) {
        if (lastKnown != null) {
          final addr = await _reverseGeocode(lastKnown.latitude, lastKnown.longitude);
          if (!mounted) return;
          setState(() {
            _pickup = addr;
            _pickupLat = lastKnown.latitude;
            _pickupLng = lastKnown.longitude;
          });
        } else if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Turn on location services to detect your pickup point.')),
          );
        }
        return;
      }

      LocationPermission perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Location permission is required to detect your current location.')),
          );
        }
        return;
      }
      if (perm == LocationPermission.deniedForever) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Location permission is blocked. Enable it from app settings.')),
          );
        }
        await Geolocator.openAppSettings();
        return;
      }
      final pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high))
          .timeout(const Duration(seconds: 8));
      final addr = await _reverseGeocode(pos.latitude, pos.longitude);
      if (!mounted) return;
      setState(() {
        _pickup = addr;
        _pickupLat = pos.latitude;
        _pickupLng = pos.longitude;
      });
    } catch (_) {
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (lastKnown != null) {
        final addr = await _reverseGeocode(lastKnown.latitude, lastKnown.longitude);
        if (!mounted) return;
        setState(() {
          _pickup = addr;
          _pickupLat = lastKnown.latitude;
          _pickupLng = lastKnown.longitude;
        });
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not detect your location. Please try again.')),
        );
      }
    } finally {
      if (mounted) setState(() => _detectingLocation = false);
    }
  }

  Future<String> _reverseGeocode(double lat, double lng) async {
    // Try server proxy first
    try {
      final headers = await AuthService.getHeaders();
      final r = await http.get(
        Uri.parse('${ApiConfig.reverseGeocode}?lat=$lat&lng=$lng'),
        headers: headers,
      ).timeout(const Duration(seconds: 6));
      if (r.statusCode == 200) {
        final d = jsonDecode(r.body) as Map<String, dynamic>;
        final parts = <String>[];
        for (final k in ['area', 'city', 'state']) {
          final v = d[k]?.toString() ?? '';
          if (v.isNotEmpty && !parts.contains(v)) parts.add(v);
        }
        if (parts.isNotEmpty) return parts.take(3).join(', ');
        final full = d['formattedAddress']?.toString() ?? '';
        if (full.isNotEmpty) return full.split(', ').take(3).join(', ');
      }
    } catch (_) {}
    // Nominatim fallback
    try {
      final r = await http.get(
        Uri.parse(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat=$lat&lon=$lng'),
        headers: const {'User-Agent': 'JagoPro/1.0'},
      ).timeout(const Duration(seconds: 5));
      if (r.statusCode == 200) {
        final d = jsonDecode(r.body) as Map<String, dynamic>;
        final addr = d['address'] as Map<String, dynamic>? ?? {};
        final parts = <String>[];
        for (final k in ['suburb', 'neighbourhood', 'city', 'town', 'state']) {
          final v = addr[k]?.toString() ?? '';
          if (v.isNotEmpty && !parts.contains(v)) parts.add(v);
        }
        if (parts.isNotEmpty) return parts.take(3).join(', ');
        final full = d['display_name']?.toString() ?? '';
        if (full.isNotEmpty) return full.split(',').take(3).join(',').trim();
      }
    } catch (_) {}
    return 'Current Location';
  }

  // ── Recent Places ─────────────────────────────────────────────────────────
  Future<void> _loadRecent() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getStringList('recent_places') ?? [];
      final list = raw
          .map((s) => Map<String, dynamic>.from(jsonDecode(s) as Map))
          .take(5)
          .toList();
      if (mounted) setState(() => _recent = list);
    } catch (_) {}
  }

  Future<void> _saveRecent(String name, double lat, double lng) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final entry = jsonEncode({'name': name, 'lat': lat, 'lng': lng});
      final raw = prefs.getStringList('recent_places') ?? [];
      raw.removeWhere((s) {
        try {
          return (jsonDecode(s) as Map)['name'] == name;
        } catch (_) {
          return false;
        }
      });
      raw.insert(0, entry);
      await prefs.setStringList('recent_places', raw.take(10).toList());
    } catch (_) {}
  }

  // ── Session Token ─────────────────────────────────────────────────────────
  void _resetSessionToken() {
    // Generate a fresh UUID-like token for a new search session
    // This groups multiple keystrokes into 1 billable session
    final rnd = DateTime.now().millisecondsSinceEpoch.toString();
    setState(() => _sessionToken = 'sess-$rnd-${_pickupLat.toInt()}');
  }

  // ── Search ────────────────────────────────────────────────────────────────
  void _onDropChanged(String q) {
    setState(() {
      _drop = q;
      _dropLat = 0.0;
      _dropLng = 0.0;
      _activeQuery = q;
      _activeField = true;
    });
    if (_debounce?.isActive == true) _debounce!.cancel();
    if (q.trim().length < 2) {
      setState(() {
        _searchResults = [];
        _searching = false;
      });
      return;
    }
    // 300ms debounce for Uber-like responsiveness (WAS 450ms)
    _debounce = Timer(const Duration(milliseconds: 300), () => _search(q));
  }

  void _onStopChanged(String q) {
    setState(() {
      _showStop = q.trim().isNotEmpty;
      _activeQuery = q;
      _activeField = false;
    });
    if (_debounce?.isActive == true) _debounce!.cancel();
    if (q.trim().length < 2) {
      setState(() {
        _searchResults = [];
        _searching = false;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), () => _search(q));
  }

  List<Map<String, dynamic>> _mapPredictions(List<dynamic> preds) {
    return preds
        .map((p) {
          final lat2 = (p['lat'] as num?)?.toDouble() ?? 0.0;
          final lng2 = (p['lng'] as num?)?.toDouble() ?? 0.0;
          final main = p['mainText']?.toString() ?? '';
          final sec = p['secondaryText']?.toString() ?? '';
          return <String, dynamic>{
            'name': p['fullDescription']?.toString() ?? p['mainText']?.toString() ?? '',
            'mainText': main,
            'secondaryText': sec,
            'placeId': p['placeId']?.toString() ?? '',
            'lat': lat2,
            'lng': lng2,
          };
        })
        .where((r) => (r['name'] as String).isNotEmpty)
        .toList();
  }

  Future<List<Map<String, dynamic>>> _searchPlacesFallback(String query) async {
    try {
      final uri = Uri.https('nominatim.openstreetmap.org', '/search', {
        'format': 'json',
        'q': query,
        'limit': '8',
        'countrycodes': 'in',
        'addressdetails': '1',
      });
      final r = await http.get(
        uri,
        headers: const {'User-Agent': 'JagoPro/1.0 (Android)'},
      ).timeout(const Duration(seconds: 6));
      if (r.statusCode != 200) return [];
      final decoded = jsonDecode(r.body);
      if (decoded is! List) return [];
      return decoded
          .map((item) {
            final p = Map<String, dynamic>.from(item as Map);
            final full = p['display_name']?.toString() ?? '';
            final parts = full.split(',').map((e) => e.trim()).where((e) => e.isNotEmpty).toList();
            return <String, dynamic>{
              'name': full,
              'mainText': parts.isNotEmpty ? parts.first : full,
              'secondaryText': parts.length > 1 ? parts.sublist(1).join(', ') : '',
              'placeId': 'nom:${p['place_id'] ?? ''}',
              'lat': double.tryParse('${p['lat'] ?? 0}') ?? 0.0,
              'lng': double.tryParse('${p['lon'] ?? 0}') ?? 0.0,
            };
          })
          .where((r) => (r['name'] as String).isNotEmpty)
          .cast<Map<String, dynamic>>()
          .toList();
    } catch (_) {
      return [];
    }
  }

  bool _needsExactPointSelection(String name) {
    final lower = name.toLowerCase();
    const keywords = [
      'station',
      'railway',
      'junction',
      'bus stand',
      'bus station',
      'airport',
      'terminal',
      'temple',
      'hospital',
      'mall',
      'market',
      'college',
      'university',
    ];
    return keywords.any(lower.contains);
  }

  List<String> _exactPointTypesFor(String name) {
    final lower = name.toLowerCase();
    if (lower.contains('airport')) {
      return ['airport', 'transit_station', 'point_of_interest'];
    }
    if (lower.contains('rail') || lower.contains('station') || lower.contains('junction')) {
      return ['train_station', 'transit_station', 'lodging', 'point_of_interest'];
    }
    if (lower.contains('bus')) {
      return ['bus_station', 'transit_station', 'lodging', 'point_of_interest'];
    }
    return ['point_of_interest', 'lodging', 'restaurant'];
  }

  String _exactPointLabel(Map<String, dynamic> option, String defaultName) {
    final name = option['name']?.toString().trim() ?? '';
    if (name.isEmpty) return defaultName;
    final lower = name.toLowerCase();
    if (lower.contains('gate')) return name;
    if (lower.contains('entrance')) return name;
    if (lower.contains('exit')) return name;
    if (lower.contains('hotel')) return '$name side';
    if (lower.contains('road')) return '$name side';
    return name;
  }

  List<Map<String, dynamic>> _curatedExactPoints(
    String name,
    double lat,
    double lng,
  ) {
    final lower = name.toLowerCase();
    Map<String, dynamic> item(
      String title,
      String address,
      double itemLat,
      double itemLng,
    ) {
      return {
        'name': title,
        'address': address,
        'lat': itemLat,
        'lng': itemLng,
        'distanceKm': JT.calculateDistance(lat, lng, itemLat, itemLng),
        'curated': true,
      };
    }

    if (lower.contains('vijayawada bus stand') ||
        lower.contains('pnbs') ||
        lower.contains('pandit nehru bus station')) {
      return [
        item('Vijayawada Bus Stand Main Gate', 'Main entry side', 16.5182,
            80.6240),
        item('Vijayawada Bus Stand Balaji Hotel Side', 'Balaji Hotel side',
            16.5168, 80.6257),
        item('Vijayawada Bus Stand Platform Side', 'Inner platform side',
            16.5187, 80.6229),
      ];
    }

    if (lower.contains('vijayawada railway station') ||
        lower.contains('railway station') ||
        lower.contains('railway junction')) {
      return [
        item('Vijayawada Railway Station Front Gate', 'Main entrance side',
            16.5182, 80.6395),
        item('Vijayawada Railway Station Platform Road Side',
            'Platform road side', 16.5169, 80.6416),
        item('Vijayawada Railway Station West Side', 'Railway colony side',
            16.5185, 80.6378),
      ];
    }

    if (lower.contains('gannavaram airport') || lower.contains('airport')) {
      return [
        item('Gannavaram Airport Departure Gate', 'Departure drop gate',
            16.5311, 80.7977),
        item('Gannavaram Airport Arrival Gate', 'Arrival pickup gate',
            16.5299, 80.7966),
      ];
    }

    if (lower.contains('benz circle')) {
      return [
        item('Benz Circle Bus Stop Side', 'Bus stop side', 16.5066, 80.6489),
        item('Benz Circle Service Road Side', 'Service road side', 16.5058,
            80.6472),
      ];
    }

    return const [];
  }

  Future<List<Map<String, dynamic>>> _loadExactPointOptions(
    String name,
    double lat,
    double lng,
  ) async {
    final headers = await AuthService.getHeaders();
    final options = <Map<String, dynamic>>[
      {
        'name': name,
        'address': 'Main point',
        'lat': lat,
        'lng': lng,
        'distanceKm': 0.0,
        'synthetic': true,
      }
    ];

    options.addAll(_curatedExactPoints(name, lat, lng));

    for (final type in _exactPointTypesFor(name)) {
      try {
        final res = await http.get(
          Uri.parse('${ApiConfig.placesNearby}?lat=$lat&lng=$lng&type=$type&radius=600'),
          headers: headers,
        ).timeout(const Duration(seconds: 5));
        if (res.statusCode != 200) continue;
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final places = (data['places'] as List<dynamic>? ?? [])
            .map((e) => Map<String, dynamic>.from(e as Map))
            .where((e) =>
                (e['name']?.toString().trim().isNotEmpty ?? false) &&
                ((e['lat'] as num?)?.toDouble() ?? 0.0) != 0.0 &&
                ((e['lng'] as num?)?.toDouble() ?? 0.0) != 0.0)
            .map((e) => {
                  'name': e['name']?.toString() ?? '',
                  'address': e['address']?.toString() ?? '',
                  'lat': (e['lat'] as num?)?.toDouble() ?? 0.0,
                  'lng': (e['lng'] as num?)?.toDouble() ?? 0.0,
                  'distanceKm': (e['distance_km'] as num?)?.toDouble() ?? 0.0,
                  'type': e['type']?.toString() ?? type,
                })
            .toList();
        options.addAll(places);
      } catch (_) {}
    }

    final deduped = <String, Map<String, dynamic>>{};
    for (final item in options) {
      final itemLat = (item['lat'] as num?)?.toDouble() ?? 0.0;
      final itemLng = (item['lng'] as num?)?.toDouble() ?? 0.0;
      final key =
          '${(item['name'] ?? '').toString().toLowerCase()}|${itemLat.toStringAsFixed(4)}|${itemLng.toStringAsFixed(4)}';
      deduped.putIfAbsent(key, () => item);
    }

    final list = deduped.values.toList()
      ..sort((a, b) => ((a['distanceKm'] as num?)?.toDouble() ?? 999)
          .compareTo((b['distanceKm'] as num?)?.toDouble() ?? 999));
    return list.take(6).toList();
  }

  Future<Map<String, dynamic>?> _showExactPointChooser(
    String name,
    double lat,
    double lng, {
    required bool forDrop,
  }) async {
    setState(() => _loadingExactPoints = true);
    final options = await _loadExactPointOptions(name, lat, lng);
    if (mounted) setState(() => _loadingExactPoints = false);
    if (!mounted) return null;

    return showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (context) {
        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.85),
            child: SingleChildScrollView(
            child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFD8E2F0),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                Text(
                  forDrop ? 'Choose exact drop point' : 'Choose exact stop point',
                  style: JT.h3,
                ),
                const SizedBox(height: 6),
                Text(
                  'Large landmarks can have multiple sides. Pick the exact point like Rapido-style pickup selection.',
                  style: JT.body,
                ),
                const SizedBox(height: 14),
                ...options.map((option) {
                  final distance = ((option['distanceKm'] as num?)?.toDouble() ?? 0.0);
                  final subtitle = (option['address']?.toString().trim().isNotEmpty ?? false)
                      ? option['address'].toString()
                      : distance > 0
                          ? '${distance.toStringAsFixed(distance < 1 ? 2 : 1)} km from main point'
                          : 'Main point';
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: _accentLight,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(Icons.place_rounded, color: _accent, size: 20),
                    ),
                    title: Text(
                      _exactPointLabel(option, name),
                      style: JT.bodyPrimary,
                    ),
                    subtitle: Text(
                      subtitle,
                      style: JT.caption,
                    ),
                    onTap: () => Navigator.pop(context, option),
                  );
                }),
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: () => Navigator.pop(context, {
                    'useMap': true,
                    'name': name,
                    'lat': lat,
                    'lng': lng,
                  }),
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    side: BorderSide(color: _accent.withValues(alpha: 0.35)),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  icon: Icon(Icons.map_rounded, color: _accent),
                  label: Text(
                    'Pick exact point on map',
                    style: JT.bodyPrimary.copyWith(color: _accent),
                  ),
                ),
              ],
            ),
            ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _search(String query) async {
    final normalizedQuery = query.trim();
    if (!mounted || normalizedQuery.length < 2) return;
    final requestId = ++_searchRequestSeq;
    setState(() => _searching = true);
    try {
      final headers = await AuthService.getHeaders();
      final lat = _pickupLat;
      final lng = _pickupLng;
      final queryParameters = <String, String>{
        'query': normalizedQuery,
        'sessionToken': _sessionToken,
        if (lat != 0.0 && lng != 0.0) ...{
          'lat': lat.toString(),
          'lng': lng.toString(),
        },
      };
      final r = await http.get(
        Uri.parse(ApiConfig.placesAutocomplete)
            .replace(queryParameters: queryParameters),
        headers: headers,
      ).timeout(const Duration(seconds: 6));
      
      if (!mounted) return;
      final currentQuery = (_activeField ? _dropCtrl.text : _stopCtrl.text).trim();
      if (requestId != _searchRequestSeq || currentQuery != normalizedQuery) {
        return;
      }
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body) as Map<String, dynamic>;
        final preds = (data['predictions'] as List<dynamic>?) ?? [];
        var mapped = _mapPredictions(preds);
        if (mapped.isEmpty) {
          mapped = await _searchPlacesFallback(normalizedQuery);
          if (!mounted) return;
          final fallbackQuery = (_activeField ? _dropCtrl.text : _stopCtrl.text).trim();
          if (requestId != _searchRequestSeq || fallbackQuery != normalizedQuery) {
            return;
          }
        }
        setState(() {
          _searchResults = mapped;
        });
      } else {
        final fallback = await _searchPlacesFallback(normalizedQuery);
        if (!mounted) return;
        final fallbackQuery = (_activeField ? _dropCtrl.text : _stopCtrl.text).trim();
        if (requestId != _searchRequestSeq || fallbackQuery != normalizedQuery) {
          return;
        }
        setState(() => _searchResults = fallback);
      }
    } catch (_) {
      final fallback = await _searchPlacesFallback(normalizedQuery);
      if (mounted) {
        final fallbackQuery = (_activeField ? _dropCtrl.text : _stopCtrl.text).trim();
        if (requestId != _searchRequestSeq || fallbackQuery != normalizedQuery) {
          return;
        }
        setState(() => _searchResults = fallback);
      }
    }
    if (mounted && requestId == _searchRequestSeq) {
      setState(() => _searching = false);
    }
  }

  // ── Selection Handlers ────────────────────────────────────────────────────
  void _selectDrop(String name, double lat, double lng) {
    HapticFeedback.selectionClick();
    _saveRecent(name, lat, lng);
    setState(() {
      _drop = name;
      _dropLat = lat;
      _dropLng = lng;
      _dropCtrl.text = name;
      _searchResults = [];
    });
    FocusScope.of(context).unfocus();
    _resetSessionToken(); // Reset token after a successful selection
    _tryProceed();
  }

  void _selectStop(String name, double lat, double lng) {
    HapticFeedback.selectionClick();
    setState(() {
      _stopCtrl.text = name;
      _searchResults = [];
    });
    FocusScope.of(context).unfocus();
  }

  Future<void> _selectKnownPlace(
    String name,
    double lat,
    double lng, {
    required bool forDrop,
  }) async {
    if (forDrop && _needsExactPointSelection(name) && lat != 0.0 && lng != 0.0) {
      final picked = await _showExactPointChooser(name, lat, lng, forDrop: true);
      if (picked != null) {
        if (picked['useMap'] == true) {
          await _pickDropOnMap();
          return;
        }
        final pickedName = picked['name']?.toString() ?? name;
        final pickedLat = (picked['lat'] as num?)?.toDouble() ?? lat;
        final pickedLng = (picked['lng'] as num?)?.toDouble() ?? lng;
        _selectDrop(pickedName, pickedLat, pickedLng);
        return;
      }
    }

    if (forDrop) {
      _selectDrop(name, lat, lng);
    } else {
      _selectStop(name, lat, lng);
    }
  }

  /// Resolves place coordinates from server then selects drop/stop.
  /// For local DB predictions lat/lng are inline; Google predictions need a detail fetch.
  Future<void> _selectFromSearch(
      Map<String, dynamic> p, {required bool forDrop}) async {
    final name = p['name']?.toString() ?? '';
    var lat = (p['lat'] as num?)?.toDouble() ?? 0.0;
    var lng = (p['lng'] as num?)?.toDouble() ?? 0.0;
    final placeId = p['placeId']?.toString() ?? '';
    if ((lat == 0.0 || lng == 0.0) &&
        placeId.isNotEmpty &&
        !placeId.startsWith('local:') &&
        !placeId.startsWith('nom:')) {
      setState(() => _detectingLocation = true);
      try {
        final headers = await AuthService.getHeaders();
        final r = await http
            .get(
              Uri.parse(ApiConfig.placeDetails).replace(queryParameters: {
                'placeId': placeId,
                'sessionToken': _sessionToken,
              }),
              headers: headers,
            )
            .timeout(const Duration(seconds: 6));
        if (r.statusCode == 200) {
          final d = jsonDecode(r.body) as Map<String, dynamic>;
          lat = (d['lat'] as num?)?.toDouble() ?? 0.0;
          lng = (d['lng'] as num?)?.toDouble() ?? 0.0;
          final resolvedName = d['address']?.toString() ?? name;
          if (!mounted) return;
          setState(() => _detectingLocation = false);
          if (forDrop) {
            _selectDrop(resolvedName, lat, lng);
          } else {
            _selectStop(resolvedName, lat, lng);
          }
          return;
        }
      } catch (_) {}
      if (mounted) setState(() => _detectingLocation = false);
    }
    if (forDrop && _needsExactPointSelection(name) && lat != 0.0 && lng != 0.0) {
      final picked = await _showExactPointChooser(name, lat, lng, forDrop: forDrop);
      if (picked != null) {
        if (picked['useMap'] == true) {
          await _pickDropOnMap();
          return;
        }
        final pickedName = picked['name']?.toString() ?? name;
        final pickedLat = (picked['lat'] as num?)?.toDouble() ?? lat;
        final pickedLng = (picked['lng'] as num?)?.toDouble() ?? lng;
        _selectDrop(pickedName, pickedLat, pickedLng);
        return;
      }
    }
    await _selectKnownPlace(name, lat, lng, forDrop: forDrop);
  }

  void _tryProceed() {
    if (_pickup.isEmpty || _drop.isEmpty) return;
    if (_pickupLat == 0 && _pickupLng == 0) return;
    _proceedToVehicles();
  }

  void _proceedToVehicles() {
    if (_dropLat == 0 && _dropLng == 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Please select a valid destination from suggestions'),
        behavior: SnackBarBehavior.floating,
      ));
      return;
    }
    HapticFeedback.mediumImpact();
    Navigator.push(
      context,
      PageRouteBuilder(
        pageBuilder: (_, __, ___) => BookingScreen(
          pickup: _pickup,
          destination: _drop,
          pickupLat: _pickupLat,
          pickupLng: _pickupLng,
          destLat: _dropLat,
          destLng: _dropLng,
          category: widget.serviceType,
          vehicleCategoryId: widget.vehicleCategoryId,
          vehicleCategoryName: widget.vehicleCategoryName,
        ),
        transitionDuration: const Duration(milliseconds: 350),
        transitionsBuilder: (_, anim, __, child) => FadeTransition(
          opacity: CurvedAnimation(parent: anim, curve: Curves.easeOut),
          child: child,
        ),
      ),
    );
  }

  // ── Map Picker ────────────────────────────────────────────────────────────
  Future<void> _pickDropOnMap() async {
    FocusScope.of(context).unfocus();
    final result = await Navigator.push<PickedLocation>(
      context,
      MaterialPageRoute(
        builder: (_) => MapLocationPicker(
          title: 'Select Drop Location',
          initialLat: _pickupLat != 0 ? _pickupLat : null,
          initialLng: _pickupLng != 0 ? _pickupLng : null,
        ),
      ),
    );
    if (result != null) {
      _selectDrop(result.address, result.lat, result.lng);
    }
  }

  // ── Build ─────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(children: [
          _buildHeader(),
          _buildInputCard(),
          if (_showStop) _buildStopField(),
          Expanded(child: _buildSuggestions()),
        ]),
      ),
    );
  }

  // ── Header ────────────────────────────────────────────────────────────────
  Widget _buildHeader() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Row(children: [
        GestureDetector(
          onTap: () => Navigator.pop(context),
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: const Color(0xFFF5F7FF),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFE8EFFF)),
            ),
            child: const Icon(Icons.arrow_back_ios_new_rounded,
                size: 18, color: JT.textPrimary),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              _isParcel ? 'Send Parcel' : 'Book a Ride',
              style: GoogleFonts.poppins(
                fontSize: 18,
                fontWeight: FontWeight.w400,
                color: JT.textPrimary,
                letterSpacing: -0.5,
              ),
            ),
            Text(
              _isParcel
                  ? 'Choose pickup & delivery location'
                  : 'Where are you going?',
              style: GoogleFonts.poppins(
                fontSize: 12,
                color: JT.textSecondary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ]),
        ),
        // Service badge
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: _accentLight,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: _accent.withValues(alpha: 0.25)),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(
              _isParcel
                  ? Icons.local_shipping_rounded
                  : Icons.electric_rickshaw_rounded,
              color: _accent,
              size: 14,
            ),
            const SizedBox(width: 4),
            Text(
              _isParcel ? 'Parcel' : 'Ride',
              style: GoogleFonts.poppins(
                color: _accent,
                fontSize: 11,
                fontWeight: FontWeight.w400,
              ),
            ),
          ]),
        ),
      ]),
    );
  }

  // ── Input Card ────────────────────────────────────────────────────────────
  Widget _buildInputCard() {
    return SlideTransition(
      position: _slideAnim,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFE8EFFF)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 16,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(children: [
          // ── Pickup row ──
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(children: [
              // Green dot
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: const Color(0xFF16A34A),
                  shape: BoxShape.circle,
                  border: Border.all(
                      color: const Color(0xFF16A34A).withValues(alpha: 0.3),
                      width: 3),
                  boxShadow: [
                    BoxShadow(
                        color:
                            const Color(0xFF16A34A).withValues(alpha: 0.3),
                        blurRadius: 6)
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _detectingLocation
                    ? Row(children: [
                        SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: _accent),
                        ),
                        const SizedBox(width: 8),
                        Text('Detecting your location…',
                            style: GoogleFonts.poppins(
                                color: JT.textSecondary,
                                fontSize: 13,
                                fontWeight: FontWeight.w500)),
                      ])
                    : GestureDetector(
                        onTap: _pickup.isEmpty ? _detectLocation : null,
                        child: Text(
                          _pickup.isEmpty
                              ? 'Detecting current location…'
                              : _pickup.split(', ').take(2).join(', '),
                          style: GoogleFonts.poppins(
                            color: _pickup.isEmpty
                                ? JT.textSecondary
                                : JT.textPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w400,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
              ),
              // GPS re-detect button
              GestureDetector(
                onTap: _detectLocation,
                child: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: _accentLight,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.my_location_rounded,
                      color: _accent, size: 16),
                ),
              ),
              if (_loadingExactPoints)
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: _accent,
                    ),
                  ),
                ),
            ]),
          ),

          // Divider with dashes
          Padding(
            padding: const EdgeInsets.only(left: 28),
            child: Row(children: List.generate(
                20,
                (i) => Expanded(
                      child: Container(
                        margin: const EdgeInsets.symmetric(horizontal: 1),
                        height: 1,
                        color: i.isEven
                            ? const Color(0xFFE8EFFF)
                            : Colors.transparent,
                      ),
                    ))),
          ),

          // ── Drop row ──
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(children: [
              // Red pin
              Container(
                width: 10,
                height: 10,
                decoration: BoxDecoration(
                  color: _accent,
                  shape: BoxShape.circle,
                  border: Border.all(
                      color: _accent.withValues(alpha: 0.3), width: 3),
                  boxShadow: [
                    BoxShadow(
                        color: _accent.withValues(alpha: 0.35),
                        blurRadius: 6)
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _dropCtrl,
                  focusNode: _dropFocus,
                  style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w400,
                  ),
                  decoration: InputDecoration.collapsed(
                    hintText: _isParcel
                        ? 'Enter delivery location'
                        : 'Where to?',
                    hintStyle: GoogleFonts.poppins(
                      color: JT.textSecondary,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  onChanged: _onDropChanged,
                  onSubmitted: (_) => _tryProceed(),
                  textInputAction: TextInputAction.search,
                ),
              ),
              if (_dropCtrl.text.isNotEmpty)
                GestureDetector(
                  onTap: () {
                    _dropCtrl.clear();
                    setState(() {
                      _drop = '';
                      _dropLat = 0.0;
                      _dropLng = 0.0;
                      _searchResults = [];
                    });
                    _dropFocus.requestFocus();
                  },
                  child: const Icon(Icons.close_rounded,
                      size: 18, color: JT.textSecondary),
                ),
            ]),
          ),

          // ── Action buttons ──
          Container(
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFF),
              borderRadius:
                  const BorderRadius.vertical(bottom: Radius.circular(16)),
              border: const Border(
                  top: BorderSide(color: Color(0xFFE8EFFF))),
            ),
            padding:
                const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            child: Row(children: [
              // Pick on Map
              _actionChip(
                Icons.map_rounded,
                'Pick on Map',
                onTap: _pickDropOnMap,
              ),
              const SizedBox(width: 8),
              // Add Stop
              if (!_showStop)
                _actionChip(
                  Icons.add_location_alt_rounded,
                  'Add Stop',
                  onTap: () {
                    setState(() => _showStop = true);
                    Future.delayed(const Duration(milliseconds: 100), () {
                      if (mounted) _stopFocus.requestFocus();
                    });
                  },
                ),
              if (_showStop)
                _actionChip(
                  Icons.remove_circle_outline_rounded,
                  'Remove Stop',
                  onTap: () {
                    setState(() {
                      _showStop = false;
                      _stopCtrl.clear();
                    });
                  },
                  isDestructive: true,
                ),
              const Spacer(),
              // Proceed button (shows when drop is selected)
              if (_dropLat != 0.0 && _dropLng != 0.0)
                GestureDetector(
                  onTap: _proceedToVehicles,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: const EdgeInsets.symmetric(
                        horizontal: 16, vertical: 8),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [_accent, _accent.withValues(alpha: 0.8)],
                        begin: Alignment.centerLeft,
                        end: Alignment.centerRight,
                      ),
                      borderRadius: BorderRadius.circular(10),
                      boxShadow: [
                        BoxShadow(
                          color: _accent.withValues(alpha: 0.35),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text(
                        'See Vehicles',
                        style: GoogleFonts.poppins(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(Icons.arrow_forward_rounded,
                          color: Colors.white, size: 14),
                    ]),
                  ),
                ),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _actionChip(IconData icon, String label,
      {required VoidCallback onTap, bool isDestructive = false}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: isDestructive
              ? const Color(0xFFFEF2F2)
              : const Color(0xFFF0F7FF),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: isDestructive
                ? const Color(0xFFFCA5A5)
                : const Color(0xFFBFDBFE),
          ),
        ),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(
            icon,
            size: 14,
            color: isDestructive
                ? const Color(0xFFEF4444)
                : JT.primary,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: GoogleFonts.poppins(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: isDestructive
                  ? const Color(0xFFEF4444)
                  : JT.primary,
            ),
          ),
        ]),
      ),
    );
  }

  // ── Add Stop Field ─────────────────────────────────────────────────────────
  Widget _buildStopField() {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE8EFFF)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(children: [
        Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            color: const Color(0xFFF59E0B),
            shape: BoxShape.circle,
            border: Border.all(
                color: const Color(0xFFF59E0B).withValues(alpha: 0.3),
                width: 3),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: TextField(
            controller: _stopCtrl,
            focusNode: _stopFocus,
            style: GoogleFonts.poppins(
              color: JT.textPrimary,
              fontSize: 13,
              fontWeight: FontWeight.w400,
            ),
            decoration: InputDecoration.collapsed(
              hintText: 'Add a stop along the way',
              hintStyle: GoogleFonts.poppins(
                color: JT.textSecondary,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
            onChanged: _onStopChanged,
          ),
        ),
        const Icon(Icons.add_circle_outline_rounded,
            size: 18, color: Color(0xFFF59E0B)),
      ]),
    );
  }

  // ── Suggestions ────────────────────────────────────────────────────────────
  Widget _buildSuggestions() {
    final isSearching = _activeQuery.length >= 2;
    final List<Map<String, dynamic>> items =
        isSearching ? _searchResults : [];

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        // ── Quick Actions ──
        if (!isSearching) ...[
          _placeRow(
            name: 'Current Location',
            mainText: 'Current Location',
            secondaryText: 'Using GPS for accuracy',
            icon: Icons.my_location_rounded,
            iconColor: JT.primary,
            onTap: () {
              // Usually handled by the manual map picker or geocoding
              _pickDropOnMap(); 
            },
          ),
          const SizedBox(height: 8),
        ],

        // Search results
        if (isSearching) ...[
          if (_searching && items.isEmpty)
            _buildShimmerLoading()
          else if (items.isNotEmpty) ...[
            _sectionHeader('Search Results', Icons.search_rounded),
            ...items.map((p) {
               final dist = (p['lat'] != 0.0) 
                  ? JT.calculateDistance(_pickupLat, _pickupLng, p['lat'], p['lng'])
                  : null;
                return _placeRow(
                  name: p['name']?.toString() ?? '',
                  mainText: p['mainText']?.toString() ?? '',
                  secondaryText: p['secondaryText']?.toString() ?? '',
                  distanceKm: dist,
                  icon: Icons.location_on_rounded,
                  iconColor: _accent,
                  onTap: () => _selectFromSearch(p, forDrop: _activeField),
                );
            }),
          ] else if (!_searching)
            _buildNoResults(),
        ]

        // Default state: recent + popular
        else ...[
          // Recent places
          if (_recent.isNotEmpty) ...[
            _sectionHeader('Recent', Icons.history_rounded),
            ..._recent.map((p) => _placeRow(
                  name: p['name']?.toString() ?? '',
                  mainText: p['name']?.toString() ?? '',
                  secondaryText: p['address']?.toString() ?? 'Recent search',
                  icon: Icons.history_rounded,
                  iconColor: JT.textSecondary,
                  onTap: () => _selectKnownPlace(
                    p['name'] ?? '',
                    (p['lat'] as num).toDouble(),
                    (p['lng'] as num).toDouble(),
                    forDrop: true,
                  ),
                )),
            const SizedBox(height: 12),
          ],

        ],
      ],
    );
  }

  Widget _sectionHeader(String label, IconData icon) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12, top: 16),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
            color: JT.textSecondary.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Icon(icon, size: 12, color: JT.textSecondary),
        ),
        const SizedBox(width: 8),
        Text(
          label.toUpperCase(),
          style: GoogleFonts.poppins(
            color: JT.textSecondary,
            fontSize: 10,
            fontWeight: FontWeight.w600,
            letterSpacing: 1.2,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(child: Divider(color: JT.textSecondary.withValues(alpha: 0.1), thickness: 1)),
      ]),
    );
  }

  Widget _placeRow({
    required String name,
    required String mainText,
    required String secondaryText,
    required IconData icon,
    required Color iconColor,
    required VoidCallback onTap,
    double? distanceKm,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFF1F5FA)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.02),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(children: [
          // Premium Icon setup
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  iconColor.withValues(alpha: 0.15),
                  iconColor.withValues(alpha: 0.05),
                ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(icon, size: 20, color: iconColor),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        mainText.isNotEmpty ? mainText : name,
                        style: GoogleFonts.poppins(
                          color: JT.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (distanceKm != null)
                      Container(
                        margin: const EdgeInsets.only(left: 8),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: iconColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '${distanceKm.toStringAsFixed(1)} km',
                          style: GoogleFonts.poppins(
                            color: iconColor,
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                  ],
                ),
                if (secondaryText.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      secondaryText,
                      style: GoogleFonts.poppins(
                        color: JT.textSecondary,
                        fontSize: 11,
                        fontWeight: FontWeight.w400,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FAFF),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.arrow_forward_ios_rounded,
                size: 10, color: JT.textSecondary),
          ),
        ]),
      ),
    );
  }

  Widget _buildShimmerLoading() {
    return Column(
      children: List.generate(
          5,
          (i) => Shimmer.fromColors(
                baseColor: Colors.grey[200]!,
                highlightColor: Colors.white,
                child: Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  height: 60,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              )),
    );
  }

  Widget _buildNoResults() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40),
      child: Column(children: [
        Icon(Icons.location_off_rounded, color: JT.iconInactive, size: 48),
        const SizedBox(height: 12),
        Text('No locations found',
            style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 13)),
      ]),
    );
  }
}
