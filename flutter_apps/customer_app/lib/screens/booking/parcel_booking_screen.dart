import 'dart:math';
import 'dart:async';
import 'dart:convert';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/trip_service.dart';
import 'package:geolocator/geolocator.dart';
import '../tracking/parcel_tracking_screen.dart';

import 'map_location_picker.dart';


// ─────────────────────────────────────────────────────────────────────────────
// Jago Logistics — Porter-style parcel booking screen
// Vehicles: Bike Parcel (≤10 kg) · Mini Truck / Tata Ace (≤500 kg) · Pickup Truck (≤2000 kg)
// ─────────────────────────────────────────────────────────────────────────────

class ParcelBookingScreen extends StatefulWidget {
  final String pickupAddress;
  final double pickupLat;
  final double pickupLng;
  final String dropAddress;
  final double dropLat;
  final double dropLng;
  final String? initialVehicleKey;
  const ParcelBookingScreen({
    super.key,
    this.pickupAddress = 'Getting location...',
    this.pickupLat = 17.3850,
    this.pickupLng = 78.4867,
    this.dropAddress = '',
    this.dropLat = 0,
    this.dropLng = 0,
    this.initialVehicleKey,
  });
  @override
  State<ParcelBookingScreen> createState() => _ParcelBookingScreenState();
}

// ── Static vehicle catalogue ──────────────────────────────────────────────────
class _ParcelVehicle {
  final String key;
  final String name;
  final String subtitle;
  final String icon;
  final String capacity;
  final int maxKg;
  final String suitable;
  final Color accentColor;
  const _ParcelVehicle({
    required this.key, required this.name, required this.subtitle,
    required this.icon, required this.capacity, required this.maxKg,
    required this.suitable, required this.accentColor,
  });
}

const _kVehicles = [
  _ParcelVehicle(
    key: 'bike_parcel', name: 'Bike Parcel', subtitle: 'Fast & lightweight',
    icon: 'bike', capacity: 'Up to 10 kg', maxKg: 10,
    suitable: 'Documents · Small boxes · Groceries · Medicine',
    accentColor: Color(0xFF2F7BFF),
  ),
  _ParcelVehicle(
    key: 'auto_parcel', name: 'Auto Parcel', subtitle: 'Medium 3-wheeler loads',
    icon: 'auto', capacity: 'Up to 50 kg', maxKg: 50,
    suitable: 'Medium boxes - Shop supplies - Small furniture',
    accentColor: Color(0xFFF59E0B),
  ),
  _ParcelVehicle(
    key: 'tata_ace', name: 'Mini Truck', subtitle: 'Tata Ace · Medium goods',
    icon: 'truck', capacity: 'Up to 500 kg', maxKg: 500,
    suitable: 'Furniture · Appliances · Bulk items · Shop stock',
    accentColor: Color(0xFFC29763),
  ),
  _ParcelVehicle(
    key: 'pickup_truck', name: 'Pickup Truck', subtitle: 'Heavy goods & business',
    icon: 'pickup_truck', capacity: 'Up to 2,000 kg', maxKg: 2000,
    suitable: 'Heavy machinery · Construction · Business logistics',
    accentColor: Color(0xFF7C3AED),
  ),
  _ParcelVehicle(
    key: 'bolero_cargo', name: 'Bolero Cargo', subtitle: 'Heavy-duty pickup',
    icon: 'pickup_truck', capacity: 'Up to 1,500 kg', maxKg: 1500,
    suitable: 'Construction - Heavy equipment - Large shipments',
    accentColor: Color(0xFF8B5CF6),
  ),
  _ParcelVehicle(
    key: 'tempo_407', name: 'Tempo 407', subtitle: 'Large commercial loads',
    icon: 'truck', capacity: 'Up to 2,500 kg', maxKg: 2500,
    suitable: 'Factory goods - Full shifting - Large shipments',
    accentColor: Color(0xFF0F766E),
  ),
];

const Map<String, String> _parcelVehicleImageUrls = {
  'bike_parcel': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_49_26_AM_gjbrxs',
  'auto_parcel': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_49_26_AM_gjbrxs',
  'tata_ace': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_51_59_AM_jzd119',
  'pickup_truck': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_54_02_AM_hicx7s',
  'bolero_cargo': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_54_02_AM_hicx7s',
  'tempo_407': 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_54_02_AM_hicx7s',
};

const _allowedParcelVehicleKeys = {
  'bike_parcel',
  'auto_parcel',
  'tata_ace',
  'pickup_truck',
  'bolero_cargo',
  'tempo_407',
};

// ── Static item types ─────────────────────────────────────────────────────────
const _kItemTypes = [
  {'icon': 'document', 'label': 'Documents'},
  {'icon': 'clothing', 'label': 'Clothing'},
  {'icon': 'electronics', 'label': 'Electronics'},
  {'icon': 'groceries', 'label': 'Groceries'},
  {'icon': 'furniture', 'label': 'Furniture'},
  {'icon': 'medicine', 'label': 'Medicine'},
  {'icon': 'fragile', 'label': 'Fragile'},
  {'icon': 'other', 'label': 'Other'},
];

// ── Static weight options ─────────────────────────────────────────────────────
const _kWeightOptions = [
  {'label': '< 1 kg',  'value': 0.5,  'desc': 'Envelopes, documents'},
  {'label': '1–5 kg',  'value': 3.0,  'desc': 'Small parcel'},
  {'label': '5–10 kg', 'value': 7.5,  'desc': 'Medium box'},
  {'label': '10–50 kg','value': 30.0, 'desc': 'Furniture part / appliance'},
  {'label': '50–200 kg','value':125.0,'desc': 'Bulk goods'},
  {'label': '200+ kg', 'value': 400.0,'desc': 'Heavy / commercial load'},
];

// ─────────────────────────────────────────────────────────────────────────────

class _ParcelBookingScreenState extends State<ParcelBookingScreen>
    with SingleTickerProviderStateMixin {

  // Controllers
  final _dropAddressCtrl    = TextEditingController();
  final _pickupAddressCtrl  = TextEditingController();
  final _receiverNameCtrl   = TextEditingController();
  final _receiverPhoneCtrl  = TextEditingController();
  final _instructionsCtrl   = TextEditingController();
  final _descCtrl           = TextEditingController();

  final _dropFocusNode      = FocusNode();
  final _pickupFocusNode    = FocusNode();

  // Step (0=vehicle, 1=locations, 2=package, 3=confirm)
  int _step = 0;
  bool _isEditingPickup = false;

  // Selections
  int _vehicleIdx = 0;
  String? _itemType;
  int _weightIdx = 0;
  bool _safetyAgreed = false;

  // Weight-based vehicle recommendation (server-side, using the live
  // parcel_vehicle_types config — not the static _kVehicles maxKg fallback)
  // — suggested once a weight is picked in Step 2, so the customer isn't
  // just guessing a vehicle in Step 0 before they know what they're sending.
  Map<String, dynamic>? _recommendedVehicle;

  // Dynamic vehicles from backend (overrides _kVehicles when loaded)
  List<_ParcelVehicle> _dynamicVehicles = [];

  // Pickup location
  late String _pickupAddr;
  late double _pickupLat;
  late double _pickupLng;
  List<Map<String, dynamic>> _pickupSuggestions = [];

  // Drop location
  double _destLat = 0, _destLng = 0;
  List<Map<String, dynamic>> _suggestions = [];
  Timer? _debounce;
  String _placesSessionToken = DateTime.now().microsecondsSinceEpoch.toString();
  int _placesSearchSeq = 0;


  // Fare estimate
  Map<String, dynamic>? _estimate;
  bool _estimating = false;

  // Booking
  bool _booking = false;

  late PageController _pageCtrl;

  List<_ParcelVehicle> get _vehicles => _dynamicVehicles.isNotEmpty ? _dynamicVehicles : _kVehicles;

  @override
  void initState() {
    super.initState();
    _pickupAddr = widget.pickupAddress;
    _pickupLat  = widget.pickupLat;
    _pickupLng  = widget.pickupLng;
    _destLat    = widget.dropLat;
    _destLng    = widget.dropLng;
    _pickupAddressCtrl.text = _pickupAddr;
    _dropAddressCtrl.text = widget.dropAddress;
    _fetchDynamicVehicles();
    if (widget.initialVehicleKey != null) {
      final initialKey = _normalizedVehicleKey(widget.initialVehicleKey!, widget.initialVehicleKey!);
      final idx = _kVehicles.indexWhere((v) => v.key == initialKey);
      if (idx >= 0) _vehicleIdx = idx;
    }
    _pageCtrl = PageController();
    if (_destLat != 0) {
      _step = 1; // Start at location step if drop is provided
    }
    // Caller (e.g. home screen) may pass 0,0 if GPS hasn't resolved yet —
    // fetch device location so dispatch isn't sent for the Atlantic Ocean.
    if (_pickupLat == 0.0 || _pickupLng == 0.0) {
      _resolvePickupFromGps();
    }
  }

  Future<void> _resolvePickupFromGps() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) return;

      final last = await Geolocator.getLastKnownPosition();
      if (last != null && last.latitude != 0 && last.longitude != 0 && mounted) {
        setState(() {
          _pickupLat = last.latitude;
          _pickupLng = last.longitude;
          if (_pickupAddr == 'Getting location...') _pickupAddr = 'Current location';
          _pickupAddressCtrl.text = _pickupAddr;
        });
      }

      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );
      if (!mounted) return;
      if (pos.latitude != 0 && pos.longitude != 0) {
        setState(() {
          _pickupLat = pos.latitude;
          _pickupLng = pos.longitude;
          if (_pickupAddr == 'Getting location...') _pickupAddr = 'Current location';
          _pickupAddressCtrl.text = _pickupAddr;
        });
        _fetchDynamicVehicles();
      }
    } catch (_) {}
  }

  Future<void> _fetchDynamicVehicles() async {
    try {
      final uri = Uri.parse(ApiConfig.parcelVehicles).replace(queryParameters: {
        'lat': _pickupLat.toString(),
        'lng': _pickupLng.toString(),
      });
      final r = await http.get(uri).timeout(const Duration(seconds: 30));
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body) as Map<String, dynamic>;
        final list = (data['vehicles'] as List<dynamic>?) ?? [];
        // Filter to the production parcel whitelist only; legacy aliases are
        // normalized before rendering so stale backend rows cannot leak into UI.
        bool _isParcelVehicle(Map<String, dynamic> m) {
          final key = (m['vehicle_key']?.toString() ?? '').toLowerCase();
          final name = (m['display_name']?.toString() ?? m['name']?.toString() ?? '').toLowerCase();
          return _allowedParcelVehicleKeys.contains(_normalizedVehicleKey(key, name));
        }

        final parsed = list
            .where((v) => _isParcelVehicle(v as Map<String, dynamic>))
            .map<_ParcelVehicle?>((v) {
          final m = v as Map<String, dynamic>;
          final colorStr = m['color']?.toString() ?? '#2F7BFF';
          final colorVal = int.tryParse(colorStr.replaceFirst('#', '0xFF')) ?? 0xFF2F7BFF;
          final rawKey = m['vehicle_key']?.toString() ?? '';
          final rawName = m['display_name']?.toString() ?? rawKey;
          final normalizedKey = _normalizedVehicleKey(rawKey, rawName);
          if (!_allowedParcelVehicleKeys.contains(normalizedKey)) return null;
          return _ParcelVehicle(
            key: normalizedKey,
            name: rawName,
            subtitle: m['description']?.toString() ?? '',
            icon: m['icon']?.toString() ?? normalizedKey,
            capacity: 'Up to ${m['max_weight_kg'] ?? 10} kg',
            maxKg: (m['max_weight_kg'] as num?)?.toInt() ?? 10,
            suitable: m['suitable_items']?.toString() ?? '',
            accentColor: Color(colorVal),
          );
        }).whereType<_ParcelVehicle>().toList();
        if (mounted && parsed.isNotEmpty) {
          setState(() => _dynamicVehicles = parsed);
          // Re-align initial vehicle selection
          if (widget.initialVehicleKey != null) {
            final initialKey = _normalizedVehicleKey(widget.initialVehicleKey!, widget.initialVehicleKey!);
            final idx = _dynamicVehicles.indexWhere((v) => v.key == initialKey);
            if (idx >= 0) setState(() => _vehicleIdx = idx);
          }
        }
      }
    } catch (_) {}
  }

  Future<void> _fetchRecommendedVehicle() async {
    try {
      final r = await http.post(
        Uri.parse(ApiConfig.parcelVehicleRecommend),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'lat': _pickupLat,
          'lng': _pickupLng,
          'weightKg': _weightKg,
        }),
      ).timeout(const Duration(seconds: 15));
      if (!mounted || r.statusCode != 200) return;
      final data = jsonDecode(r.body) as Map<String, dynamic>;
      final recommended = data['recommended'] as Map<String, dynamic>?;
      setState(() => _recommendedVehicle = recommended);
    } catch (_) {
      // Silent — this is a suggestion, not a required step; the existing
      // exceeds-maxKg guard on the weight list still prevents an
      // incompatible vehicle/weight combination from being submitted.
    }
  }

  @override
  void dispose() {
    _dropAddressCtrl.dispose();
    _pickupAddressCtrl.dispose();
    _receiverNameCtrl.dispose();
    _receiverPhoneCtrl.dispose();
    _instructionsCtrl.dispose();
    _descCtrl.dispose();
    _dropFocusNode.dispose();
    _pickupFocusNode.dispose();
    _debounce?.cancel();
    _pageCtrl.dispose();
    super.dispose();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _ParcelVehicle get _vehicle => _vehicles[_vehicleIdx];
  double get _weightKg => (_kWeightOptions[_weightIdx]['value'] as num).toDouble();

  String _normalizedVehicleKey(String rawKey, String fallbackName) {
    final hay = '$rawKey $fallbackName'.toLowerCase();
    if (hay.contains('tempo') || hay.contains('407')) return 'tempo_407';
    if (hay.contains('bolero')) return 'bolero_cargo';
    if (hay.contains('auto')) return 'auto_parcel';
    if (hay.contains('pickup')) return 'pickup_truck';
    if (hay.contains('tata') || hay.contains('mini')) return 'tata_ace';
    if (hay.contains('bike')) return 'bike_parcel';
    return '';
  }

  Widget _buildVehicleImage(String key, {double width = 56, double height = 56}) {
    final normalizedKey = _normalizedVehicleKey(key, key);
    final url = _parcelVehicleImageUrls[normalizedKey];
    if (url == null) {
      return Icon(
        _iconForKey(normalizedKey),
        color: const Color(0xFF2F7BFF),
        size: width * 0.72,
      );
    }
    return CachedNetworkImage(
      imageUrl: url,
      width: width,
      height: height,
      fit: BoxFit.contain,
      placeholder: (_, __) => const SizedBox.shrink(),
      errorWidget: (_, __, ___) => Icon(
        _iconForKey(normalizedKey),
        color: const Color(0xFF2F7BFF),
        size: width * 0.72,
      ),
    );
  }

  void _refreshPlacesSessionToken() {
    _placesSessionToken = DateTime.now().microsecondsSinceEpoch.toString();
  }

  bool get _step0Valid => true;
  bool get _step1Valid => _dropAddressCtrl.text.trim().isNotEmpty && _destLat != 0;
  bool get _step2Valid => _itemType != null && _safetyAgreed;
  bool get _step3Valid => _receiverNameCtrl.text.trim().isNotEmpty &&
      _receiverPhoneCtrl.text.trim().length == 10;

  void _next() {
    if (_step < 3) {
      setState(() => _step++);
      _pageCtrl.animateToPage(_step,
          duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
      if (_step == 3) _fetchEstimate();
    }
  }

  void _back() {
    if (_step > 0) {
      setState(() => _step--);
      _pageCtrl.animateToPage(_step,
          duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
    } else {
      Navigator.pop(context);
    }
  }

  bool get _canNext {
    switch (_step) {
      case 0: return _step0Valid;
      case 1: return _step1Valid;
      case 2: return _step2Valid;
      case 3: return _step3Valid;
      default: return false;
    }
  }

  // ── Drop address search ───────────────────────────────────────────────────────

  void _onPickupSearch(String q) {
    _debounce?.cancel();
    setState(() {
      _pickupAddr = q;
      _pickupLat = 0;
      _pickupLng = 0;
    });
    if (q.length < 3) { setState(() => _pickupSuggestions = []); return; }
    _debounce = Timer(const Duration(milliseconds: 400), () => _searchAddress(q, isPickup: true));
  }

  void _onDropSearch(String q) {
    _debounce?.cancel();
    setState(() {
      _destLat = 0;
      _destLng = 0;
    });
    if (q.length < 3) { setState(() => _suggestions = []); return; }
    _debounce = Timer(const Duration(milliseconds: 400), () => _searchAddress(q, isPickup: false));
  }

  Future<void> _searchAddress(String q, {required bool isPickup}) async {
    final normalizedQuery = q.trim();
    if (normalizedQuery.length < 3) return;
    _refreshPlacesSessionToken();
    final requestId = ++_placesSearchSeq;
    try {
      final headers = await AuthService.getHeaders();
      final queryParameters = <String, String>{
        'input': normalizedQuery,
        'sessionToken': _placesSessionToken,
      };
      final refLat = isPickup ? _pickupLat : (_pickupLat != 0 ? _pickupLat : widget.pickupLat);
      final refLng = isPickup ? _pickupLng : (_pickupLng != 0 ? _pickupLng : widget.pickupLng);
      if (refLat != 0 && refLng != 0) {
        queryParameters['lat'] = refLat.toString();
        queryParameters['lng'] = refLng.toString();
      }
      final r = await http.get(
        Uri.parse(ApiConfig.placesAutocomplete).replace(queryParameters: queryParameters),
        headers: headers,
      ).timeout(const Duration(seconds: 30));
      if (r.statusCode == 200) {
        final currentQuery = (isPickup ? _pickupAddressCtrl.text : _dropAddressCtrl.text).trim();
        if (!mounted || requestId != _placesSearchSeq || currentQuery != normalizedQuery) {
          return;
        }
        final body = jsonDecode(r.body);
        final list = (body['predictions'] ?? body['results'] ?? body) as List;
        if (mounted) setState(() {
          final results = list.map<Map<String, dynamic>>((p) => {
            'description': p['fullDescription'] ?? p['description'] ?? p['formatted_address'] ?? p['name'] ?? '',
            'place_id': p['placeId'] ?? p['place_id'] ?? '',
            'main_text': p['mainText'] ?? '',
            'secondary_text': p['secondaryText'] ?? '',
            'lat': (p['lat'] ?? 0).toDouble(),
            'lng': (p['lng'] ?? 0).toDouble(),
          }).toList();
          if (isPickup) {
            _pickupSuggestions = results;
          } else {
            _suggestions = results;
          }
        });
      }
    } catch (_) {}
  }

  void _selectSuggestion(Map<String, dynamic> s, {required bool isPickup}) async {
    final desc = s['description'] as String;
    final selectedLat = (s['lat'] as num?)?.toDouble() ?? 0;
    final selectedLng = (s['lng'] as num?)?.toDouble() ?? 0;
    setState(() {
      if (isPickup) {
        _pickupAddressCtrl.text = desc;
        _pickupAddr = desc;
        _pickupLat = selectedLat;
        _pickupLng = selectedLng;
        _pickupSuggestions = [];
        _isEditingPickup = false;
      } else {
        _dropAddressCtrl.text = desc;
        _destLat = selectedLat;
        _destLng = selectedLng;
        _suggestions = [];
      }
    });

    // Resolve lat/lng if not available
    double currentLat = isPickup ? _pickupLat : _destLat;
    if (currentLat == 0 && s['place_id'] != null && s['place_id'] != '') {
      try {
        final headers = await AuthService.getHeaders();
        final placeId = s['place_id']?.toString() ?? '';
        final r = await http.get(
          Uri.parse(ApiConfig.placeDetails).replace(queryParameters: {
            'placeId': placeId,
            'sessionToken': _placesSessionToken,
          }),
          headers: headers,
        ).timeout(const Duration(seconds: 5));
        if (r.statusCode == 200) {
          final d = jsonDecode(r.body);
          if (mounted) setState(() {
            final lat = (d['lat'] ?? d['result']?['geometry']?['location']?['lat'] ?? 0).toDouble();
            final lng = (d['lng'] ?? d['result']?['geometry']?['location']?['lng'] ?? 0).toDouble();
            if (isPickup) {
              _pickupLat = lat;
              _pickupLng = lng;
            } else {
              _destLat = lat;
              _destLng = lng;
            }
          });
        }
      } catch (_) {}
    }

    try {
      final headers = await AuthService.getHeaders();
      await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/places/select'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'placeId': s['place_id'],
          'queryText': desc,
          'placeLabel': s['main_text'] ?? desc.split(',').first,
          'placeAddress': desc,
          'lat': isPickup ? _pickupLat : _destLat,
          'lng': isPickup ? _pickupLng : _destLng,
        }),
      ).timeout(const Duration(seconds: 5));
    } catch (_) {}
  }

  // ── Fare estimate ─────────────────────────────────────────────────────────────

  Future<void> _fetchEstimate() async {
    setState(() { _estimating = true; _estimate = null; });
    try {
      // Rough haversine distance
      final dist = _haversine(
        _pickupLat, _pickupLng, _destLat, _destLng);
      final headers = await AuthService.getHeaders();
      final r = await http.post(
        Uri.parse(ApiConfig.parcelQuote),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'vehicleCategory': _vehicle.key,
          'totalDistanceKm': dist,
          'weightKg': _weightKg,
          'pickupLat': _pickupLat,
          'pickupLng': _pickupLng,
          'dropLocations': [{'address': _dropAddressCtrl.text}],
        }),
      ).timeout(const Duration(seconds: 30));
      if (r.statusCode == 200 && mounted) {
        setState(() => _estimate = jsonDecode(r.body));
      } else if (r.statusCode == 400 && mounted) {
        final e = jsonDecode(r.body);
        _showSnack(e['message'] ?? 'Weight exceeds vehicle limit', error: true);
        setState(() { _step = 0; });
        _pageCtrl.animateToPage(0, duration: const Duration(milliseconds: 300), curve: Curves.easeInOut);
      }
    } catch (_) {}
    if (mounted) setState(() => _estimating = false);
  }

  double _haversine(double lat1, double lng1, double lat2, double lng2) {
    const r = 6371.0;
    final lat1Rad = lat1 * pi / 180;
    final lat2Rad = lat2 * pi / 180;
    final dLat = (lat2 - lat1) * pi / 180;
    final dLng = (lng2 - lng1) * pi / 180;
    final a = sin(dLat / 2) * sin(dLat / 2) +
        cos(lat1Rad) * cos(lat2Rad) * sin(dLng / 2) * sin(dLng / 2);
    final c = 2 * atan2(sqrt(a), sqrt(1 - a));
    return (r * c * 1.3).clamp(0.5, 200.0);
  }

  // ── Book ─────────────────────────────────────────────────────────────────────

  Future<bool> _ensureNoActiveBookingBeforeContinue() async {
    final active = await TripService.getActiveBooking();
    final booking = active['booking'];
    final bookingType = active['bookingType']?.toString();
    if (booking is! Map<String, dynamic> || bookingType == null || bookingType.isEmpty) {
      return true;
    }

    final canCancel = booking['canCancel'] == true;
    final bookingId = booking['id']?.toString() ?? '';
    final title = bookingType == 'parcel' ? 'Active parcel found' : 'Active ride found';
    final subtitle = bookingType == 'parcel'
        ? (booking['pickupAddress']?.toString() ?? 'Parcel booking in progress')
        : (booking['destinationAddress']?.toString() ?? 'Ride booking in progress');

    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            Text(
              subtitle,
              style: const TextStyle(fontSize: 14, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(context, 'track'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: JT.primary,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: const Text('Track Current Booking', style: TextStyle(color: Colors.white)),
              ),
            ),
            if (canCancel) ...[
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context, 'cancel'),
                  style: OutlinedButton.styleFrom(
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Text('Cancel Current Booking And Continue'),
                ),
              ),
            ],
          ],
        ),
      ),
    );

    if (!mounted) return false;
    if (action == 'track' && bookingId.isNotEmpty) {
      if (bookingType == 'parcel') {
        await Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => ParcelTrackingScreen(orderId: bookingId)),
        );
      }
      return false;
    }

    if (action == 'cancel' && bookingId.isNotEmpty && canCancel) {
      final result = bookingType == 'parcel'
          ? await TripService.cancelParcelOrder(
              bookingId,
              reason: 'Customer cancelled to continue with a new parcel booking',
            )
          : await TripService.cancelTrip(
              bookingId,
              'Customer cancelled to continue with a new parcel booking',
            );
      if (result['success'] == true) {
        _showSnack('Previous booking cancelled. Continue with your new parcel.', error: false);
        return true;
      }
      _showSnack(
        result['message']?.toString() ?? result['error']?.toString() ?? 'Could not cancel current booking.',
        error: true,
      );
    }

    return false;
  }

  Future<void> _book() async {
    if (!_step3Valid || _booking) return;
    if (_pickupLat == 0.0 || _pickupLng == 0.0) {
      _showSnack('Pickup location not detected. Please tap pickup field and select on map.', error: true);
      return;
    }
    if (_destLat == 0.0 || _destLng == 0.0) {
      _showSnack('Delivery location is missing. Please re-select drop location.', error: true);
      return;
    }
    final canContinue = await _ensureNoActiveBookingBeforeContinue();
    if (!canContinue) return;
    setState(() => _booking = true);
    try {
      final dist = _haversine(_pickupLat, _pickupLng, _destLat, _destLng);
      final headers = await AuthService.getHeaders();
      final payload = {
        'vehicleCategory': _vehicle.key,
        'pickupAddress': _pickupAddr,
        'pickupLat': _pickupLat,
        'pickupLng': _pickupLng,
        'pickupContactName': '',
        'pickupContactPhone': '',
        'dropLocations': [
          {
            'address': _dropAddressCtrl.text,
            'lat': _destLat,
            'lng': _destLng,
            'receiverName': _receiverNameCtrl.text.trim(),
            'receiverPhone': _receiverPhoneCtrl.text.trim(),
          }
        ],
        'totalDistanceKm': dist,
        'weightKg': _weightKg,
        'paymentMethod': 'cash',
        'notes': [
          if (_itemType != null) 'Item: $_itemType',
          if (_descCtrl.text.trim().isNotEmpty) 'Desc: ${_descCtrl.text.trim()}',
          if (_instructionsCtrl.text.trim().isNotEmpty) 'Instructions: ${_instructionsCtrl.text.trim()}',
        ].join(' | '),
      };
      debugPrint('[PARCEL_BOOKING] payload=${jsonEncode(payload)}');
      final r = await http.post(
        Uri.parse(ApiConfig.parcelBook),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode(payload),
      ).timeout(const Duration(seconds: 30));
      if (!mounted) return;
      if (r.statusCode == 200 || r.statusCode == 201) {
        final data = jsonDecode(r.body);
        final orderId = data['orderId']?.toString() ?? data['id']?.toString() ?? '';
        Navigator.pushReplacement(context, MaterialPageRoute(
          builder: (_) => ParcelTrackingScreen(orderId: orderId),
        ));
      } else {
        final e = jsonDecode(r.body);
        if (e['orderId'] != null) {
          await _ensureNoActiveBookingBeforeContinue();
        }
        _showSnack(e['message'] ?? 'Booking failed. Try again.', error: true);
      }
    } catch (e) {
      _showSnack('Network error. Please try again.', error: true);
    } finally {
      if (mounted) setState(() => _booking = false);
    }
  }

  Future<void> _useCurrentLocationForPickup() async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        _showSnack('Location permission denied', error: true);
        return;
      }

      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      final addr = await _reverseGeocode(pos.latitude, pos.longitude);
      if (mounted) {
        setState(() {
          _pickupAddr = addr;
          _pickupLat = pos.latitude;
          _pickupLng = pos.longitude;
          _pickupAddressCtrl.text = addr;
          _isEditingPickup = false;
        });
        _fetchDynamicVehicles();
      }
    } catch (e) {
      _showSnack('Could not get current location', error: true);
    }
  }

  Future<String> _reverseGeocode(double lat, double lng) async {
    try {
      final headers = await AuthService.getHeaders();
      final r = await http.get(
        Uri.parse('${ApiConfig.reverseGeocode}?lat=$lat&lng=$lng'),
        headers: headers,
      ).timeout(const Duration(seconds: 10));
      if (r.statusCode == 200) {
        final d = jsonDecode(r.body);
        return d['formattedAddress'] ?? d['address'] ?? 'Selected Location';
      }
    } catch (_) {}
    return 'Selected Location';
  }

  void _onEnterPickupManually() {
    setState(() {
      _isEditingPickup = true;
    });
    _pickupFocusNode.requestFocus();
  }

  void _onEnterDropManually() {
    setState(() {
      _destLat = 0; // Clear lat/lng to show input field again if it was set
    });
    _dropFocusNode.requestFocus();
  }

  Future<void> _pickPickupOnMap() async {
    final result = await Navigator.push<PickedLocation>(
      context,
      MaterialPageRoute(builder: (_) => MapLocationPicker(
        title: 'Select Pickup Location',
        initialLat: _pickupLat,
        initialLng: _pickupLng,
      )),
    );
    if (result != null && mounted) {
      setState(() {
        _pickupAddr = result.address;
        _pickupLat = result.lat;
        _pickupLng = result.lng;
        _pickupAddressCtrl.text = result.address;
        _isEditingPickup = false;
      });
      _fetchDynamicVehicles();
    }
  }

  Future<void> _pickDropOnMap() async {
    final result = await Navigator.push<PickedLocation>(
      context,
      MaterialPageRoute(builder: (_) => MapLocationPicker(
        title: 'Select Delivery Location',
        initialLat: _destLat != 0 ? _destLat : _pickupLat,
        initialLng: _destLng != 0 ? _destLng : _pickupLng,
      )),
    );
    if (result != null && mounted) {
      setState(() {
        _dropAddressCtrl.text = result.address;
        _destLat = result.lat;
        _destLng = result.lng;
        _suggestions = [];
      });
    }
  }


  // ─────────────────────────────────────────────────────────────────────────────
  // BUILD
  // ─────────────────────────────────────────────────────────────────────────────

  // Local theme colors for Logistics (Earthy Gold-focused)
  static const Color logisticsOrange = Color(0xFFC29763);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Column(children: [
        _buildNewHeader(),
        _buildNewStepBar(),
        Expanded(
          child: PageView(
            controller: _pageCtrl,
            physics: const NeverScrollableScrollPhysics(),
            children: [
              _buildStep0Vehicle(),
              _buildStep1Location(),
              _buildStep2Package(),
              _buildStep3Confirm(),
            ],
          ),
        ),
        _buildNewBottomButton(),
      ]),
    );
  }

  // ── New Premium Header ────────────────────────────────────────────────────────
  Widget _buildNewHeader() {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFB8834D), logisticsOrange, Color(0xFFDDBD94)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: logisticsOrange.withValues(alpha: 0.22),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 0, 20, 18),
          child: Row(children: [
            Material(
              color: Colors.white.withValues(alpha: 0.16),
              borderRadius: BorderRadius.circular(12),
              child: IconButton(
                icon: const Icon(Icons.arrow_back_rounded, color: Colors.white, size: 20),
                onPressed: _back,
              ),
            ),
            const SizedBox(width: 12),
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.inventory_2_rounded, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Parcel Delivery',
                    style: GoogleFonts.poppins(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Door-to-door, OTP-verified',
                    style: GoogleFonts.poppins(
                      color: Colors.white.withValues(alpha: 0.85),
                      fontSize: 12.5,
                      fontWeight: FontWeight.w400,
                    ),
                  ),
                ],
              ),
            ),
          ]),
        ),
      ),
    );
  }

  // ── New Premium Step Bar ────────────────────────────────────────────────────────
  Widget _buildNewStepBar() {
    final steps = ['Vehicle', 'Location', 'Package', 'Confirm'];
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 12),
      child: Row(
        children: List.generate(steps.length, (i) {
          final isCompleted = i < _step;
          final isActive = i == _step;
          final isLast = i == steps.length - 1;

          return Expanded(
            child: Row(
              children: [
                Column(
                  children: [
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: isActive || isCompleted ? logisticsOrange : Colors.white,
                        border: Border.all(
                          color: isActive || isCompleted ? logisticsOrange : const Color(0xFFE5E7EB),
                          width: 1.5,
                        ),
                      ),
                      child: Center(
                        child: isCompleted
                            ? const Icon(Icons.check, color: Colors.white, size: 16)
                            : Text(
                                '${i + 1}',
                                style: GoogleFonts.poppins(
                                  color: isActive ? Colors.white : const Color(0xFF9CA3AF),
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      steps[i],
                      style: GoogleFonts.poppins(
                        fontSize: 11,
                        fontWeight: isActive ? FontWeight.w600 : FontWeight.w400,
                        color: isActive ? logisticsOrange : const Color(0xFF9CA3AF),
                      ),
                    ),
                  ],
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      height: 1,
                      margin: const EdgeInsets.only(bottom: 22, left: 8, right: 8),
                      color: isCompleted ? logisticsOrange : const Color(0xFFE5E7EB),
                    ),
                  ),
              ],
            ),
          );
        }),
      ),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STEP 0 — Vehicle selection (Redesigned)
  // ─────────────────────────────────────────────────────────────────────────────

  Widget _buildStep0Vehicle() {
    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Choose Your Vehicle',
            style: GoogleFonts.poppins(
              fontSize: 22,
              fontWeight: FontWeight.w600,
              color: const Color(0xFF1F2937),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Select based on your package size and weight',
            style: GoogleFonts.poppins(
              fontSize: 14,
              color: const Color(0xFF6B7280),
            ),
          ),
          const SizedBox(height: 24),

          // Vehicle list
          ...List.generate(_vehicles.length, (idx) {
            final v = _vehicles[idx];
            final isSelected = _vehicleIdx == idx;
            return GestureDetector(
              onTap: () => setState(() => _vehicleIdx = idx),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: isSelected ? logisticsOrange.withValues(alpha: 0.05) : Colors.white,
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(
                    color: isSelected ? logisticsOrange : const Color(0xFFE5E7EB).withValues(alpha: 0.8),
                    width: isSelected ? 1.5 : 1,
                  ),
                  boxShadow: isSelected
                    ? [BoxShadow(color: logisticsOrange.withValues(alpha: 0.16), blurRadius: 16, offset: const Offset(0, 6))]
                    : [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6, offset: const Offset(0, 2))],
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 58,
                      height: 58,
                      decoration: BoxDecoration(
                        color: v.accentColor.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Center(
                        child: _buildVehicleImage(v.key),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  v.name,
                                  style: GoogleFonts.poppins(
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                    color: const Color(0xFF111827),
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: v.accentColor.withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  v.capacity,
                                  style: GoogleFonts.poppins(
                                    fontSize: 9,
                                    fontWeight: FontWeight.w600,
                                    color: v.accentColor,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(
                            v.subtitle,
                            style: GoogleFonts.poppins(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              color: const Color(0xFF4B5563),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            v.suitable,
                            style: GoogleFonts.poppins(
                              fontSize: 12,
                              color: const Color(0xFF9CA3AF),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      width: 20,
                      height: 20,
                      margin: const EdgeInsets.only(top: 4),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: isSelected ? logisticsOrange : Colors.white,
                        border: Border.all(
                          color: isSelected ? logisticsOrange : const Color(0xFFD1D5DB),
                          width: 1.5,
                        ),
                      ),
                      child: isSelected 
                        ? const Icon(Icons.check, color: Colors.white, size: 14)
                        : null,
                    ),
                  ],
                ),
              ),
            );
          }),

          const SizedBox(height: 20),

          // About Card
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFFF9FAFB),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFF3F4F6)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 32, height: 32,
                      decoration: BoxDecoration(
                        color: const Color(0xFFE5E7EB),
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: const Icon(Icons.local_shipping, color: Color(0xFF374151), size: 16),
                    ),
                    const SizedBox(width: 10),
                    Text(
                      'About Jago Logistics',
                      style: GoogleFonts.poppins(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF1F2937),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _buildInfoPoint(Icons.location_on_outlined, 'Door-to-door parcel delivery'),
                _buildInfoPoint(Icons.lock_outline, 'OTP-verified secure pickup & delivery'),
                _buildInfoPoint(Icons.track_changes, 'Live GPS tracking throughout'),
                _buildInfoPoint(Icons.payments_outlined, 'Transparent pricing, no hidden charges'),
              ],
            ),
          ),
          const SizedBox(height: 24), // Spacing for bottom button
        ],
      ),
    );
  }

  Widget _buildInfoPoint(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: logisticsOrange, size: 16),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: GoogleFonts.poppins(
                fontSize: 12,
                color: const Color(0xFF4B5563),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ── STEP 1 — Pickup & Drop locations (Redesigned) ──────────────────────────

  Widget _buildStep1Location() {
    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 0),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Pickup & Delivery', style: GoogleFonts.poppins(
            fontSize: 22, fontWeight: FontWeight.w600, color: const Color(0xFF1F2937))),
        const SizedBox(height: 4),
        Text('Confirm pickup and enter delivery address',
            style: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF6B7280))),
        const SizedBox(height: 32),

        // ── Pickup Card ──
        Container(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0xFFE5E7EB).withValues(alpha: 0.8)),
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 10, offset: const Offset(0, 4))],
          ),
          child: Column(
            children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Pickup', style: GoogleFonts.poppins(
                        fontSize: 16, fontWeight: FontWeight.w600, color: const Color(0xFF374151))),
                    GestureDetector(
                      onTap: _useCurrentLocationForPickup,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF7ED), 
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: logisticsOrange.withValues(alpha: 0.2)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.my_location_rounded, size: 14, color: logisticsOrange),
                            const SizedBox(width: 6),
                            Text('Use Current', style: GoogleFonts.poppins(
                              fontSize: 12, color: logisticsOrange, fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 44, height: 44,
                      decoration: const BoxDecoration(color: logisticsOrange, shape: BoxShape.circle),
                      child: const Icon(Icons.location_on_rounded, color: Colors.white, size: 24)),
                    const SizedBox(width: 16),
                    Expanded(
                      child: _isEditingPickup 
                      ? Container(
                          height: 52,
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(30),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.05),
                                blurRadius: 10,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: _pickupAddressCtrl,
                                  focusNode: _pickupFocusNode,
                                  onChanged: _onPickupSearch,
                                  style: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF1F2937)),
                                  decoration: InputDecoration(
                                    hintText: 'Search pickup location',
                                    hintStyle: GoogleFonts.poppins(color: const Color(0xFF9CA3AF), fontSize: 13),
                                    border: InputBorder.none,
                                    enabledBorder: InputBorder.none,
                                    focusedBorder: InputBorder.none,
                                    isDense: true,
                                    contentPadding: EdgeInsets.zero,
                                  ),
                                ),
                              ),
                              Container(
                                width: 32, height: 32,
                                decoration: const BoxDecoration(color: logisticsOrange, shape: BoxShape.circle),
                                child: const Icon(Icons.search, color: Colors.white, size: 16),
                              ),
                            ],
                          ),
                        )
                      : Text(_pickupAddr, style: GoogleFonts.poppins(
                          fontSize: 14, color: const Color(0xFF6B7280), fontWeight: FontWeight.w400),
                          maxLines: 2, overflow: TextOverflow.ellipsis),
                    ),
                  ],
                ),
              if (_pickupSuggestions.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Divider(height: 1, color: Color(0xFFF3F4F6)),
                ..._pickupSuggestions.take(3).map((s) => ListTile(
                  onTap: () => _selectSuggestion(s, isPickup: true),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.location_on_outlined, size: 18, color: Color(0xFF9CA3AF)),
                  title: Text(s['description'] ?? '', 
                    style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF4B5563)),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                  dense: true,
                  visualDensity: VisualDensity.compact,
                )),
              ],
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: _buildLocationSubBtn(Icons.map_outlined, 'Pick on Map', _pickPickupOnMap),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildLocationSubBtn(Icons.edit_outlined, 'Enter Manually', _onEnterPickupManually),
                  ),
                ],
              ),
            ],
          ),
        ),

        // ── Connector (Dotted) ──
        Padding(
          padding: const EdgeInsets.only(left: 45),
          child: Column(
            children: List.generate(4, (i) => Container(
              width: 1.5,
              height: 5,
              margin: const EdgeInsets.symmetric(vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFFE5E7EB),
                borderRadius: BorderRadius.circular(1),
              ),
            )),
          ),
        ),

        // ── Drop / Delivery Card ──
        Container(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 20),
          decoration: BoxDecoration(
            color: _destLat != 0 ? logisticsOrange.withValues(alpha: 0.01) : Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: _destLat != 0 ? logisticsOrange.withValues(alpha: 0.3) : const Color(0xFFE5E7EB).withValues(alpha: 0.8)),
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 10, offset: const Offset(0, 4))],
          ),
          child: Column(
            children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Container(
                      width: 44, height: 44,
                      decoration: const BoxDecoration(color: Color(0xFFF3F4F6), shape: BoxShape.circle),
                      child: const Icon(Icons.location_on_rounded, color: Color(0xFF9CA3AF), size: 24)),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('DELIVERY LOCATION', style: GoogleFonts.poppins(
                                  fontSize: 11, color: const Color(0xFF6B7280),
                                  fontWeight: FontWeight.w700, letterSpacing: 0.5)),
                              const Icon(Icons.keyboard_arrow_up_rounded, color: Color(0xFF9CA3AF), size: 18),
                            ],
                          ),
                          const SizedBox(height: 8),
                          _destLat == 0 
                          ? Container(
                              height: 52,
                              padding: const EdgeInsets.symmetric(horizontal: 20),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(30),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.05),
                                    blurRadius: 10,
                                    offset: const Offset(0, 4),
                                  ),
                                ],
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: TextField(
                                      controller: _dropAddressCtrl,
                                      focusNode: _dropFocusNode,
                                      onChanged: _onDropSearch,
                                      style: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF1F2937)),
                                      decoration: InputDecoration(
                                        hintText: 'Search delivery location',
                                        hintStyle: GoogleFonts.poppins(color: const Color(0xFF9CA3AF), fontSize: 13),
                                        border: InputBorder.none,
                                        enabledBorder: InputBorder.none,
                                        focusedBorder: InputBorder.none,
                                        errorBorder: InputBorder.none,
                                        disabledBorder: InputBorder.none,
                                        isDense: true,
                                        contentPadding: EdgeInsets.zero,
                                      ),
                                    ),
                                  ),
                                  Container(
                                    width: 32, height: 32,
                                    decoration: const BoxDecoration(color: logisticsOrange, shape: BoxShape.circle),
                                    child: const Icon(Icons.search, color: Colors.white, size: 16),
                                  ),
                                ],
                              ),
                            )
                          : Text(_dropAddressCtrl.text, style: GoogleFonts.poppins(
                              fontSize: 14, color: const Color(0xFF1F2937), fontWeight: FontWeight.w500),
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                        ],
                      ),
                    ),
                  ],
                ),
              
              if (_suggestions.isNotEmpty) ...[
                const SizedBox(height: 12),
                const Divider(height: 1, color: Color(0xFFF3F4F6)),
                ..._suggestions.take(3).map((s) => ListTile(
                  onTap: () => _selectSuggestion(s, isPickup: false),
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.location_on_outlined, size: 18, color: Color(0xFF9CA3AF)),
                  title: Text(s['description'] ?? '', 
                    style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF4B5563)),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                  dense: true,
                  visualDensity: VisualDensity.compact,
                )),
              ],

              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: _buildLocationSubBtn(Icons.map_outlined, 'Pick on Map', _pickDropOnMap),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildLocationSubBtn(Icons.edit_outlined, 'Enter Manually', _onEnterDropManually),
                  ),
                ],
              ),
            ],
          ),
        ),

        const SizedBox(height: 32),

        // ── Vehicle Reminder ──
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFFFF2EF), // Light peach/orange tint
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(children: [
            Container(
              width: 52, height: 52,
              decoration: const BoxDecoration(
                  color: Colors.white, shape: BoxShape.circle),
              child: Padding(
                padding: const EdgeInsets.all(8.0),
                child: _buildVehicleImage(_vehicle.key, width: 36, height: 36),
              )),
            const SizedBox(width: 16),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_vehicle.name, style: GoogleFonts.poppins(
                  fontSize: 15, fontWeight: FontWeight.w600, color: const Color(0xFF1F2937))),
              Text(_vehicle.capacity, style: GoogleFonts.poppins(
                  fontSize: 13, color: const Color(0xFF6B7280))),
            ])),
            const Icon(Icons.chevron_right_rounded, color: Color(0xFF9CA3AF), size: 24),
          ]),
        ),
        const SizedBox(height: 100),
      ]),
    );
  }

  Widget _buildLocationSubBtn(IconData icon, String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFFF9FAFB),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFF3F4F6)),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 18, color: logisticsOrange.withValues(alpha: 0.8)),
            const SizedBox(width: 8),
            Text(label, style: GoogleFonts.poppins(
              fontSize: 13, color: const Color(0xFF4B5563), fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }

  // ── STEP 2 — Package details (Redesigned) ──────────────────────────────────

  Widget _buildStep2Package() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Package Details', style: GoogleFonts.poppins(
            fontSize: 22, fontWeight: FontWeight.w600, color: const Color(0xFF1F2937))),
        const SizedBox(height: 4),
        Text('What are you sending today?',
            style: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF6B7280))),
        const SizedBox(height: 24),

        Text('ITEM TYPE', style: GoogleFonts.poppins(
            fontSize: 12, fontWeight: FontWeight.w600, color: const Color(0xFF374151), letterSpacing: 0.5)),
        const SizedBox(height: 12),
        Wrap(spacing: 10, runSpacing: 10, children: _kItemTypes.map((t) {
          final sel = _itemType == t['label'];
          return GestureDetector(
            onTap: () => setState(() => _itemType = t['label'] as String),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              decoration: BoxDecoration(
                color: sel ? logisticsOrange : Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: sel ? logisticsOrange : const Color(0xFFE5E7EB)),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(_itemTypeIcon(t['icon']!), color: sel ? Colors.white : const Color(0xFF4B5563), size: 18),
                const SizedBox(width: 8),
                Text(t['label']!, style: GoogleFonts.poppins(
                    fontSize: 13, color: sel ? Colors.white : const Color(0xFF4B5563), fontWeight: sel ? FontWeight.w600 : FontWeight.w400)),
              ]),
            ),
          );
        }).toList()),

        const SizedBox(height: 32),
        Text('APPROXIMATE WEIGHT', style: GoogleFonts.poppins(
            fontSize: 12, fontWeight: FontWeight.w600, color: const Color(0xFF374151), letterSpacing: 0.5)),
        const SizedBox(height: 12),
        ...List.generate(_kWeightOptions.length, (i) {
          final opt = _kWeightOptions[i];
          final sel = _weightIdx == i;
          final exceeds = (opt['value'] as num).toDouble() > _vehicle.maxKg;
          return Opacity(
            opacity: exceeds ? 0.4 : 1.0,
            child: GestureDetector(
              onTap: exceeds ? null : () {
                setState(() {
                  _weightIdx = i;
                  _recommendedVehicle = null;
                });
                _fetchRecommendedVehicle();
              },
              child: Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: sel ? logisticsOrange.withValues(alpha: 0.05) : Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: sel ? logisticsOrange : const Color(0xFFE5E7EB)),
                ),
                child: Row(children: [
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(opt['label'] as String, style: GoogleFonts.poppins(
                        fontSize: 14, fontWeight: FontWeight.w600, color: const Color(0xFF111827))),
                    Text(opt['desc'] as String, style: GoogleFonts.poppins(
                        fontSize: 12, color: const Color(0xFF6B7280))),
                  ])),
                  if (sel) const Icon(Icons.check_circle, color: logisticsOrange, size: 20),
                ]),
              ),
            ),
          );
        }),

        if (_recommendedVehicle != null &&
            _recommendedVehicle!['key']?.toString() != _vehicle.key) ...[
          const SizedBox(height: 6),
          Builder(builder: (context) {
            final rec = _recommendedVehicle!;
            final recName = rec['name']?.toString() ?? 'a different vehicle';
            final recKey = rec['key']?.toString() ?? '';
            return Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFBFDBFE)),
              ),
              child: Row(children: [
                const Icon(Icons.lightbulb_outline_rounded, color: Color(0xFF2563EB), size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text('For this weight, $recName is a better fit.',
                      style: GoogleFonts.poppins(fontSize: 12.5, color: const Color(0xFF1E40AF))),
                ),
                TextButton(
                  onPressed: () {
                    final idx = _vehicles.indexWhere((v) => v.key == recKey);
                    if (idx >= 0) {
                      setState(() {
                        _vehicleIdx = idx;
                        _recommendedVehicle = null;
                      });
                    }
                  },
                  child: const Text('Switch'),
                ),
              ]),
            );
          }),
        ],

        const SizedBox(height: 24),
        Text('PACKAGE DESCRIPTION (OPTIONAL)', style: GoogleFonts.poppins(
            fontSize: 12, fontWeight: FontWeight.w600, color: const Color(0xFF374151), letterSpacing: 0.5)),
        const SizedBox(height: 12),
        _buildStepTextField(_descCtrl, 'e.g. 55 inch TV, wrapped in bubble wrap', Icons.edit_note_rounded),

        const SizedBox(height: 24),
        Row(children: [
          Checkbox(
            value: _safetyAgreed,
            activeColor: logisticsOrange,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
            onChanged: (v) => setState(() => _safetyAgreed = v ?? false)),
          Expanded(child: GestureDetector(
            onTap: () => setState(() => _safetyAgreed = !_safetyAgreed),
            child: Text('I confirm the package contains no prohibited items',
              style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF4B5563))),
          )),
        ]),
      ]),
    );
  }

  // ── STEP 3 — Confirm details (Redesigned) ──────────────────────────────────

  Widget _buildStep3Confirm() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Receiver Details', style: GoogleFonts.poppins(
            fontSize: 22, fontWeight: FontWeight.w600, color: const Color(0xFF1F2937))),
        const SizedBox(height: 4),
        Text('Who should we contact at delivery?',
            style: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF6B7280))),
        const SizedBox(height: 24),

        _buildStepTextField(_receiverNameCtrl, 'Receiver Name', Icons.person_outline),
        const SizedBox(height: 16),
        _buildStepTextField(_receiverPhoneCtrl, 'Phone Number', Icons.phone_android_outlined, keyboard: TextInputType.phone),
        const SizedBox(height: 16),
        _buildStepTextField(_instructionsCtrl, 'Delivery Instructions (Optional)', Icons.notes, lines: 3),

        const SizedBox(height: 32),
        if (_estimate != null) _buildNewFareCard(),
        const SizedBox(height: 100),
      ]),
    );
  }

  // ── Fare Card (Redesigned) ──────────────────────────────────────────────────

  Widget _buildNewFareCard() {
    final e = _estimate!;
    final total = (e['grandTotal'] ?? e['totalFare'] ?? 0);
    
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: logisticsOrange.withValues(alpha: 0.2)),
        boxShadow: [BoxShadow(color: logisticsOrange.withValues(alpha: 0.08), blurRadius: 16, offset: const Offset(0, 6))],
      ),
      child: Column(children: [
        Row(children: [
          Container(
            width: 36, height: 36,
            decoration: BoxDecoration(
              color: logisticsOrange.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.receipt_long_rounded, color: logisticsOrange, size: 18),
          ),
          const SizedBox(width: 10),
          Text('Fare Breakdown', style: GoogleFonts.poppins(
              fontSize: 15, fontWeight: FontWeight.w600, color: const Color(0xFF1F2937))),
          const Spacer(),
          Text('${e['distance']} km', style: GoogleFonts.poppins(
              fontSize: 12.5, fontWeight: FontWeight.w500, color: const Color(0xFF9CA3AF))),
        ]),
        const SizedBox(height: 18),
        _fareMiniRow('Base Fare', '₹${e['baseFare'] ?? 0}'),
        _fareMiniRow('Distance Charge', '₹${e['distanceFare'] ?? 0}'),
        _fareMiniRow('Weight Charge', '₹${e['weightFare'] ?? 0}'),
        if ((e['loadingCharge'] ?? 0) > 0)
          _fareMiniRow('Loading Charge', '₹${e['loadingCharge']}'),
        const Divider(height: 28),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('Total Bill Amount', style: GoogleFonts.poppins(
              fontSize: 15, fontWeight: FontWeight.w600, color: const Color(0xFF1F2937))),
          Text('₹$total', style: GoogleFonts.poppins(
              fontSize: 26, fontWeight: FontWeight.w700, color: logisticsOrange)),
        ]),
      ]),
    );
  }

  Widget _fareMiniRow(String label, String val) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
        Text(label, style: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF6B7280))),
        Text(val, style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w500, color: const Color(0xFF1F2937))),
      ]),
    );
  }

  // ── Bottom Navigation Button ────────────────────────────────────────────────

  Widget _buildNewBottomButton() {
    final canGoNext = _canNext;
    String label = '';
    
    switch (_step) {
      case 0: label = 'Confirm ${_vehicle.name}'; break;
      case 1: label = 'Add Package Details'; break;
      case 2: label = 'Review & Book'; break;
      case 3: label = 'Book My Delivery'; break;
    }

    return Container(
      padding: EdgeInsets.fromLTRB(24, 16, 24, 16 + MediaQuery.of(context).padding.bottom),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, -5),
          ),
        ],
      ),
      child: GestureDetector(
        onTap: canGoNext ? (_step == 3 ? _book : _next) : null,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          height: 60,
          decoration: BoxDecoration(
            gradient: canGoNext
                ? const LinearGradient(
                    colors: [logisticsOrange, Color(0xFFD6B58F)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  )
                : null,
            color: canGoNext ? null : const Color(0xFFE5E7EB),
            borderRadius: BorderRadius.circular(16),
            boxShadow: canGoNext ? [
              BoxShadow(
                color: logisticsOrange.withValues(alpha: 0.28),
                blurRadius: 12,
                offset: const Offset(0, 4),
              )
            ] : null,
          ),
          child: Center(
            child: _booking || _estimating
              ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
              : Text(
                  label,
                  style: GoogleFonts.poppins(
                    color: canGoNext ? Colors.white : const Color(0xFF9CA3AF),
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
          ),
        ),
      ),
    );
  }

  // ── Shared UI Components ───────────────────────────────────────────────────

  Widget _buildStepTextField(TextEditingController ctrl, String hint, IconData icon, 
      {TextInputType keyboard = TextInputType.text, int lines = 1}) {
    return TextField(
      controller: ctrl,
      keyboardType: keyboard,
      maxLines: lines,
      style: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF111827)),
      onChanged: (_) => setState(() {}),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: GoogleFonts.poppins(fontSize: 13, color: const Color(0xFF9CA3AF)),
        prefixIcon: Icon(icon, color: const Color(0xFF9CA3AF), size: 20),
        filled: true,
        fillColor: const Color(0xFFF9FAFB),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: logisticsOrange, width: 1.5)),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      ),
    );
  }

  IconData _iconForKey(String key) {
    if (key.contains('bike')) return Icons.electric_bike_rounded;
    if (key.contains('tata') || key.contains('mini')) return Icons.local_shipping_rounded;
    if (key.contains('pickup') || key.contains('truck')) return Icons.fire_truck_rounded;
    return Icons.inventory_2_rounded;
  }

  IconData _itemTypeIcon(String key) {
    switch (key) {
      case 'document': return Icons.description_rounded;
      case 'clothing': return Icons.checkroom_rounded;
      case 'electronics': return Icons.devices_rounded;
      case 'groceries': return Icons.shopping_basket_rounded;
      case 'furniture': return Icons.chair_rounded;
      case 'medicine': return Icons.medication_rounded;
      case 'fragile': return Icons.local_drink_rounded;
      default: return Icons.inventory_2_rounded;
    }
  }

  void _showSnack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: const TextStyle(color: Colors.white)),
      backgroundColor: error ? Colors.redAccent : logisticsOrange,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    ));
  }
}
