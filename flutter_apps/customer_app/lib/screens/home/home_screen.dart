import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../widgets/vehicle_artwork.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import '../tracking/tracking_screen.dart';
import '../tracking/trip_completion_screen.dart';
import '../tracking/local_pool_status_screen.dart';
import '../booking/parcel_booking_screen.dart';
import '../booking/premium_location_screen.dart';
import '../../services/trip_service.dart';
import '../auth/login_screen.dart';
import '../outstation_pool/outstation_pool_screen.dart';
import '../car_share/car_share_options_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  final SocketService _socket = SocketService();

  String _userName = 'there';
  String _pickup = 'Getting location...';
  double _pickupLat = 0.0, _pickupLng = 0.0;
  bool _locationReady = false;
  List<Map<String, dynamic>> _vehicleCategories = [];
  List<Map<String, dynamic>> _activeServices = [];
  // TEMP diagnostic: which request last wrote _activeServices, and with what
  // coordinates/keys — visible on-screen so this can be read off an
  // installed release build without ADB/logcat access. Remove once the
  // Cab/Premium visibility issue is confirmed fixed.
  int _activeServicesRequestSeq = 0;
  String _activeServicesDebugLine = '';
  List<dynamic> _savedPlaces = [];
  List<Map<String, dynamic>> _recentTrips = [];
  Map<String, dynamic>? _activeTrip;
  Map<String, dynamic>? _activeParcel;
  Map<String, dynamic>? _activePoolBooking;
  Map<String, dynamic>? _activeOutstationBooking;
  StreamSubscription? _driverAssignedSub;
  StreamSubscription? _tripCancelledSub;
  StreamSubscription? _tripStatusSub;
  Timer? _searchingTimer; // auto-cancel if no pilot found within 5 min
  Timer?
      _statePollTimer; // 5s poll during searching — server is source of truth
  bool _homeLoading = true;
  Timer? _loadingTimeout;
  // True until the services grid has made at least one location-aware fetch
  // attempt (success or failure) — drives a "finding services near you"
  // indicator so the Bike/Parcel-only pre-location fallback doesn't read as
  // the complete list while a cold GPS fix is still in flight.
  bool _servicesLoading = true;
  Timer? _servicesLoadingTimeout;

  // New state: banners + feature flags
  List<Map<String, dynamic>> _banners = [];
  int _bannerIndex = 0;
  Timer? _bannerTimer;
  final PageController _bannerPageCtrl = PageController();

  // ── Live Map state ────────────────────────────────────────────────────────
  GoogleMapController? _mapController;
  Timer? _nearbyDriversTimer;
  final Map<String, BitmapDescriptor> _markerIconCache = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadUser();
    // Fetch once immediately (location not resolved yet, so this call is
    // unfiltered/city-wide) and again once _getLocation() resolves so the
    // location-filtered services endpoint actually gets lat/lng — otherwise
    // the home grid stays stuck on the empty-state fallback (Bike + Parcel
    // only) for the whole session even after location becomes available.
    _getLocation().then((_) => _fetchActiveServices());
    _fetchHome();
    _fetchActiveServices();
    _loadSavedPlaces();
    _loadRecentTrips();
    _fetchBanners();
    _fetchFeatureFlags();
    _connectSocket();
    // Safety fallback: never show loading more than 6 seconds
    _loadingTimeout = Timer(const Duration(seconds: 6), () {
      if (mounted && _homeLoading) setState(() => _homeLoading = false);
    });
    // Safety fallback: a stuck/slow GPS fix shouldn't leave the "finding
    // services near you" indicator up forever — fall back to whatever the
    // unfiltered fetch returned (or the Bike/Parcel default) after 10s.
    _servicesLoadingTimeout = Timer(const Duration(seconds: 10), () {
      if (mounted && _servicesLoading) setState(() => _servicesLoading = false);
    });
    // Auto-scroll banner every 4 seconds
    _bannerTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted || _banners.isEmpty) return;
      final next = (_bannerIndex + 1) % _banners.length;
      _bannerPageCtrl.animateToPage(next,
          duration: const Duration(milliseconds: 400), curve: Curves.easeInOut);
    });
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _checkPendingFcmNotification());
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkActiveTripAndRecovery());
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkActiveParcel());
    WidgetsBinding.instance.addPostFrameCallback((_) => _maybeShowTutorial());
    // Start nearby drivers polling (10s — battery-optimised, still smooth enough)
    _nearbyDriversTimer = Timer.periodic(
        const Duration(seconds: 10), (_) => _fetchNearbyDrivers());
    _fetchNearbyDrivers(); // fetch immediately
  }

  Future<void> _loadSavedPlaces() async {
    try {
      final places = await TripService.getSavedPlaces();
      if (mounted)
        setState(() => _savedPlaces = places
            .where((p) => p['label'] == 'Home' || p['label'] == 'Work')
            .toList());
    } catch (_) {}
  }

  Future<void> _loadRecentTrips() async {
    try {
      final headers = await AuthService.getHeaders();
      final r = await http.get(
          Uri.parse(
              '${ApiConfig.baseUrl}/api/app/customer/trips?limit=3&status=completed'),
          headers: headers);
      if (r.statusCode == 200 && mounted) {
        final data = jsonDecode(r.body);
        final trips =
            (data['trips'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ??
                [];
        setState(() => _recentTrips = trips);
      }
    } catch (_) {}
  }

  Future<void> _fetchBanners() async {
    try {
      final headers = await AuthService.getHeaders();
      final r = await http
          .get(Uri.parse('${ApiConfig.baseUrl}/api/app/banners'),
              headers: headers)
          .timeout(const Duration(seconds: 6));
      if (r.statusCode == 200 && mounted) {
        final data = jsonDecode(r.body) as Map<String, dynamic>;
        final list =
            (data['banners'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ??
                [];
        setState(() => _banners = list);
      }
    } catch (_) {}
  }

  Future<void> _fetchFeatureFlags() async {
    try {
      final r = await http
          .get(Uri.parse('${ApiConfig.baseUrl}/api/app/feature-flags'))
          .timeout(const Duration(seconds: 6));
      if (r.statusCode == 200 && mounted) {
        // feature flags loaded (unused by current UI)
      }
    } catch (_) {}
  }

  // ── LIVE MAP: Nearby Drivers ─────────────────────────────────────────────

  Future<BitmapDescriptor> _getVehicleMarkerIcon(String vehicleType) async {
    if (_markerIconCache.containsKey(vehicleType))
      return _markerIconCache[vehicleType]!;
    final descriptor = await _drawVehicleMarker(vehicleType);
    _markerIconCache[vehicleType] = descriptor;
    return descriptor;
  }

  Future<BitmapDescriptor> _drawVehicleMarker(String vehicleType) async {
    const size = 72.0;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, size, size));

    // Pick color + emoji by vehicle type
    Color bg;
    String emoji;
    if (vehicleType.contains('bike') || vehicleType.contains('moto')) {
      bg = const Color(0xFF2F7BFF);
      emoji = '🏍️';
    } else if (vehicleType.contains('auto')) {
      bg = const Color(0xFF5B9DFF);
      emoji = '🛺';
    } else if (vehicleType.contains('parcel') ||
        vehicleType.contains('cargo')) {
      bg = const Color(0xFF1A6FDB);
      emoji = '📦';
    } else {
      bg = const Color(0xFF2563EB);
      emoji = '🚗';
    }

    // Shadow
    final shadowPaint = Paint()
      ..color = bg.withValues(alpha: 0.35)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);
    canvas.drawCircle(
        const Offset(size / 2, size / 2 + 2), size / 2 - 6, shadowPaint);

    // Circle background
    canvas.drawCircle(
        const Offset(size / 2, size / 2), size / 2 - 8, Paint()..color = bg);

    // White border
    canvas.drawCircle(
      const Offset(size / 2, size / 2),
      size / 2 - 8,
      Paint()
        ..color = Colors.white
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );

    // Emoji
    final tp = TextPainter(
      text: TextSpan(text: emoji, style: const TextStyle(fontSize: 26)),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, Offset((size - tp.width) / 2, (size - tp.height) / 2 - 1));

    final picture = recorder.endRecording();
    final img = await picture.toImage(size.toInt(), size.toInt());
    final data = await img.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.bytes(data!.buffer.asUint8List());
  }

  Future<void> _fetchNearbyDrivers() async {
    if (!mounted || !_locationReady) return;
    try {
      final headers = await AuthService.getHeaders();
      final uri = Uri.parse(ApiConfig.nearbyDrivers).replace(queryParameters: {
        'lat': _pickupLat.toString(),
        'lng': _pickupLng.toString(),
        'radius': '5',
      });
      final r = await http
          .get(uri, headers: headers)
          .timeout(const Duration(seconds: 5));
      if (!mounted || r.statusCode != 200) return;

      final data = jsonDecode(r.body) as Map<String, dynamic>;
      final drivers =
          (data['drivers'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ??
              [];

      final Set<Marker> newMarkers = {};
      for (final d in drivers) {
        final lat = double.tryParse(d['lat']?.toString() ?? '');
        final lng = double.tryParse(d['lng']?.toString() ?? '');
        if (lat == null || lng == null) continue;

        final id = d['id']?.toString() ?? '';
        final vehicleType =
            (d['vehicleCategoryName'] ?? d['vehicleName'] ?? 'car')
                .toString()
                .toLowerCase();
        final heading = double.tryParse(d['heading']?.toString() ?? '0') ?? 0;
        final rating = double.tryParse(d['rating']?.toString() ?? '0') ?? 0;

        final icon = await _getVehicleMarkerIcon(vehicleType);

        newMarkers.add(Marker(
          markerId: MarkerId('driver_$id'),
          position: LatLng(lat, lng),
          icon: icon,
          rotation: heading,
          anchor: const Offset(0.5, 0.5),
          flat: true, // rotates with map
          infoWindow: InfoWindow(
            title: d['fullName']?.toString() ?? 'Driver',
            snippet: rating > 0 ? '⭐ ${rating.toStringAsFixed(1)}' : null,
          ),
        ));
      }

    } catch (_) {}
  }

  Future<void> _checkPendingFcmNotification() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final pendingStr = prefs.getString('pending_notification');
      if (pendingStr != null && pendingStr.isNotEmpty) {
        await prefs.remove('pending_notification');
        final data = jsonDecode(pendingStr) as Map<String, dynamic>;
        final type = data['type']?.toString() ?? '';
        final tripId = data['tripId']?.toString() ?? '';
        if (!mounted || tripId.isEmpty) return;
        if (type == 'trip_accepted' ||
            type == 'driver_assigned' ||
            type == 'driver_arrived') {
          // Verify trip is still active — prevents stale FCM from causing blank screen
          try {
            final verifyHeaders = await AuthService.getHeaders();
            final tripCheck = await http.get(Uri.parse(ApiConfig.activeTrip),
                headers: verifyHeaders);
            if (tripCheck.statusCode == 200) {
              final td = jsonDecode(tripCheck.body);
              final activeT = td['trip'] as Map<String, dynamic>?;
              if (activeT == null) return;
              final st = activeT['currentStatus']?.toString() ?? '';
              if (st == 'completed' || st == 'cancelled' || st.isEmpty) return;
            } else {
              return;
            }
          } catch (_) {
            return;
          }
          if (!mounted) return;
          Navigator.pushReplacement(
              context,
              MaterialPageRoute(
                  builder: (_) => TrackingScreen(tripId: tripId)));
        } else if (type == 'trip_completed') {
          try {
            final verifyHeaders = await AuthService.getHeaders();
            final tripCheck = await http.get(
              Uri.parse('${ApiConfig.trackTrip}/$tripId'),
              headers: verifyHeaders,
            );
            if (tripCheck.statusCode != 200) return;
            final td = jsonDecode(tripCheck.body);
            final trip = td['trip'] as Map<String, dynamic>?;
            if (trip == null) return;
            if (!mounted) return;
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(
                builder: (_) => TripCompletionScreen(trip: trip),
              ),
            );
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  Future<void> _checkActiveTrip() async {
    try {
      final headers = await AuthService.getHeaders();
      final r =
          await http.get(Uri.parse(ApiConfig.activeTrip), headers: headers);
      if (!mounted) return;
      if (r.statusCode == 401) {
        _handleUnauthorized();
        return;
      }
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body);
        final trip = data['trip'] as Map<String, dynamic>?;
        if (trip != null) {
          final status = trip['currentStatus']?.toString() ?? '';
          if (status != 'completed' && status != 'cancelled') {
            setState(() => _activeTrip = trip);
            // Start auto-cancel timer if searching and no pilot found yet
            if (status == 'searching') {
              _startSearchingTimer(trip['id']?.toString() ?? '');
            }
            // Restore tracking for active trips including searching state
            if (['accepted', 'arrived', 'on_the_way', 'in_progress', 'driver_assigned', 'searching']
                .contains(status)) {
              final tripId = trip['id']?.toString() ?? '';
              if (tripId.isNotEmpty && mounted) {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => TrackingScreen(tripId: tripId),
                  ),
                );
              }
            }
          }
        }
      }
    } catch (_) {}
  }

  Future<void> _checkActiveTripAndRecovery() async {
    await _checkActiveTrip();
    if (!mounted) return;
    if (_activeTrip != null) return;
    await _checkPendingRecovery();
    if (!mounted) return;
    if (_activeTrip != null) return;
    await _checkActivePoolBooking();
    if (!mounted) return;
    if (_activePoolBooking != null) return;
    await _checkActiveOutstationBooking();
  }

  // Car Share: mirrors _checkActiveTrip's role for normal rides, via the
  // dedicated /pool/active endpoint (Rolling Pool has no per-user "current
  // trip" concept the way trip_requests does, so this doesn't reuse
  // _checkActiveTrip's query — it's a separate booking system entirely).
  Future<void> _checkActivePoolBooking() async {
    if (_activeTrip != null) return;
    try {
      final headers = await AuthService.getHeaders();
      final r = await http
          .get(Uri.parse(ApiConfig.localPoolActive), headers: headers)
          .timeout(const Duration(seconds: 10));
      if (!mounted) return;
      if (r.statusCode == 401) {
        _handleUnauthorized();
        return;
      }
      if (r.statusCode != 200) return;
      final data = jsonDecode(r.body) as Map<String, dynamic>;
      final payload = data['data'] as Map<String, dynamic>?;
      if (payload?['active'] == true) {
        setState(() => _activePoolBooking = payload!['booking'] as Map<String, dynamic>?);
      }
    } catch (_) {}
  }

  // Intercity / Outstation Pool: same idea, via /outstation-pool/v2/active.
  Future<void> _checkActiveOutstationBooking() async {
    if (_activeTrip != null || _activePoolBooking != null) return;
    try {
      final headers = await AuthService.getHeaders();
      final r = await http
          .get(Uri.parse(ApiConfig.outstationPoolActive), headers: headers)
          .timeout(const Duration(seconds: 10));
      if (!mounted) return;
      if (r.statusCode == 401) {
        _handleUnauthorized();
        return;
      }
      if (r.statusCode != 200) return;
      final data = jsonDecode(r.body) as Map<String, dynamic>;
      if (data['active'] == true) {
        setState(() => _activeOutstationBooking = data['booking'] as Map<String, dynamic>?);
      }
    } catch (_) {}
  }

  Future<void> _checkPendingRecovery() async {
    if (_activeTrip != null) return;
    try {
      final headers = await AuthService.getHeaders();
      final pendingRes = await http
          .get(Uri.parse(ApiConfig.ridePendingRecovery), headers: headers)
          .timeout(const Duration(seconds: 10));
      if (!mounted) return;
      if (pendingRes.statusCode == 401) {
        _handleUnauthorized();
        return;
      }
      if (pendingRes.statusCode != 200) return;
      final pendingData = jsonDecode(pendingRes.body) as Map<String, dynamic>;
      if (pendingData['pending'] != true) return;

      final bookingIntentId = pendingData['bookingIntentId']?.toString() ?? '';
      if (bookingIntentId.isEmpty) return;

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Completing your paid booking…')),
        );
      }

      final recoverRes = await http
          .post(
            Uri.parse(ApiConfig.rideRecoverBooking),
            headers: headers,
            body: jsonEncode({'bookingIntentId': bookingIntentId}),
          )
          .timeout(const Duration(seconds: 20));
      if (!mounted) return;
      if (recoverRes.statusCode == 401) {
        _handleUnauthorized();
        return;
      }
      if (recoverRes.statusCode != 200 && recoverRes.statusCode != 409) return;

      final recoverData = jsonDecode(recoverRes.body) as Map<String, dynamic>;
      final tripId = recoverData['tripId']?.toString() ??
          recoverData['trip']?['id']?.toString() ??
          '';
      if (tripId.isNotEmpty && mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(builder: (_) => TrackingScreen(tripId: tripId)),
        );
      }
    } catch (_) {}
  }

  Future<void> _checkActiveParcel() async {
    if (_activeTrip != null) return;
    try {
      final headers = await AuthService.getHeaders();
      final r = await http.get(Uri.parse(ApiConfig.activeBooking), headers: headers);
      if (!mounted) return;
      if (r.statusCode == 401) {
        _handleUnauthorized();
        return;
      }
      if (r.statusCode != 200) return;
      final data = jsonDecode(r.body);
      if (data['bookingType']?.toString() != 'parcel') return;
      final booking = data['booking'] as Map<String, dynamic>?;
      if (booking == null) return;
      final status = booking['currentStatus']?.toString() ?? '';
      if (status == 'completed' || status == 'cancelled') return;

      setState(() => _activeParcel = booking);
      final orderId = booking['id']?.toString() ?? '';
      if (orderId.isEmpty || !mounted) return;

      if (['accepted', 'driver_assigned', 'picked_up', 'in_transit', 'searching', 'pending']
          .contains(status)) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => TrackingScreen(tripId: orderId, isParcel: true),
          ),
        );
      }
    } catch (_) {}
  }

  void _startSearchingTimer(String tripId) {
    _searchingTimer?.cancel();
    // Auto-cancel after 5 minutes if still searching
    _searchingTimer =
        Timer(const Duration(minutes: 5), () => _autoCancelSearching(tripId));
    // Poll server every 5s while searching — catches driver acceptance when socket is down
    _statePollTimer?.cancel();
    _statePollTimer =
        Timer.periodic(const Duration(seconds: 5), (_) => _pollTripState());
  }

  Future<void> _pollTripState() async {
    if (!mounted || _activeTrip == null) {
      _statePollTimer?.cancel();
      return;
    }
    try {
      final headers = await AuthService.getHeaders();
      final r = await http
          .get(Uri.parse(ApiConfig.activeTrip), headers: headers)
          .timeout(const Duration(seconds: 4));
      if (!mounted) return;
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body);
        final trip = data['trip'] as Map<String, dynamic>?;
        if (trip == null) {
          // Trip gone — cancelled or completed
          _statePollTimer?.cancel();
          _searchingTimer?.cancel();
          setState(() => _activeTrip = null);
          return;
        }
        final status = trip['currentStatus']?.toString() ?? '';
        if (status == 'completed' || status == 'cancelled') {
          _statePollTimer?.cancel();
          _searchingTimer?.cancel();
          setState(() => _activeTrip = null);
          return;
        }
        setState(() => _activeTrip = trip);
        // Driver accepted while socket was down → navigate to tracking
        if (['accepted', 'arrived', 'on_the_way', 'in_progress', 'driver_assigned']
            .contains(status)) {
          _statePollTimer?.cancel();
          _searchingTimer?.cancel();
          final tripId = trip['id']?.toString() ?? '';
          if (tripId.isNotEmpty && mounted) {
            Navigator.pushReplacement(
                context,
                MaterialPageRoute(
                    builder: (_) => TrackingScreen(tripId: tripId)));
          }
        }
      }
    } catch (_) {} // network error — keep polling
  }

  Future<void> _autoCancelSearching(String tripId) async {
    if (!mounted || _activeTrip == null) return;
    final status = _activeTrip!['currentStatus']?.toString() ?? '';
    if (status != 'searching') return;
    try {
      final h = await AuthService.getHeaders();
      await http.post(Uri.parse(ApiConfig.cancelTrip),
          headers: {...h, 'Content-Type': 'application/json'},
          body: jsonEncode({
            'tripId': tripId,
            'reason': 'Auto-cancelled: no pilot available nearby'
          }));
    } catch (_) {}
    if (!mounted) return;
    setState(() => _activeTrip = null);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text('No pilot found nearby. Ride auto-cancelled.',
          style: GoogleFonts.poppins(
              color: Colors.white, fontWeight: FontWeight.w400, fontSize: 13)),
      backgroundColor: JT.primaryDark,
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      duration: const Duration(seconds: 5),
    ));
  }

  Future<void> _maybeShowTutorial() async {
    final prefs = await SharedPreferences.getInstance();
    final seen = prefs.getBool('home_tutorial_seen') ?? false;
    if (seen || !mounted) return;
    await prefs.setBool('home_tutorial_seen', true);
    // Small delay so the home screen finishes building first
    await Future.delayed(const Duration(milliseconds: 800));
    if (!mounted) return;
    showDialog(
      context: context,
      barrierDismissible: true,
      barrierColor: Colors.black.withValues(alpha: 0.75),
      builder: (ctx) => Dialog(
        backgroundColor: Colors.transparent,
        insetPadding: const EdgeInsets.all(20),
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: const BoxDecoration(
                  color: JT.primary,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                ),
                child: Row(
                  children: [
                    const Text('👋', style: TextStyle(fontSize: 28)),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Welcome!',
                                style: GoogleFonts.poppins(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w400,
                                    fontSize: 18)),
                            Text('Here\'s a quick guide to get you started',
                                style: GoogleFonts.poppins(
                                    color: Colors.white.withValues(alpha: 0.85),
                                    fontSize: 12)),
                          ]),
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    _TutorialTip(
                        icon: '🔍',
                        title: 'Search Destination',
                        desc:
                            'Tap "Where do you want to go?" to search for your destination and see instant fare estimates.'),
                    const SizedBox(height: 14),
                    _TutorialTip(
                        icon: '🚗',
                        title: 'Choose a Service',
                        desc:
                            'Select from Auto, Bike, Car, Ride Pool, Parcel, and more based on your need.'),
                    const SizedBox(height: 14),
                    _TutorialTip(
                        icon: '💳',
                        title: 'Wallet & Payments',
                        desc:
                            'Recharge your wallet for cashless rides. Tap the wallet icon in the top right.'),
                    const SizedBox(height: 14),
                    _TutorialTip(
                        icon: '🔔',
                        title: 'Stay Updated',
                        desc:
                            'Enable notifications to get real-time alerts for your rides, offers, and more.'),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: JT.gradientButton(
                          label: "Got it, Let's Go!",
                          onTap: () => Navigator.pop(ctx)),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _connectSocket() {
    _socket.connect(ApiConfig.socketUrl).then((_) {
      // IMPORTANT: Reduced delay to 500ms to ensure faster responsiveness
      // while still avoiding immediate stale navigation on initial connection.
      Future.delayed(const Duration(milliseconds: 500), () {
        if (!mounted) return;
        _driverAssignedSub = _socket.onDriverAssigned.listen((data) {
          if (!mounted) return;
          final tripId = data['tripId']?.toString() ?? '';
          // Only navigate if the tripId matches our current active trip context
          // This prevents stale socket events from navigating incorrectly
          if (tripId.isNotEmpty) {
            final activeTripId = _activeTrip?['id']?.toString() ?? '';
            // Only navigate if we have a confirmed active trip matching this event.
            // Prevents stale socket events from causing blank-screen navigation on login.
            // Only navigate if this is the active screen (prevents double-navigation
            // if BookingScreen is already on top or TrackingScreen is already open)
            final isCurrent = ModalRoute.of(context)?.isCurrent ?? false;
            if (activeTripId.isNotEmpty && activeTripId == tripId && isCurrent) {
              Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                      builder: (_) => TrackingScreen(tripId: tripId)));
            }
          }
        });

        // Clear active trip state when trip is cancelled or completed
        _tripCancelledSub = _socket.onTripCancelled.listen((data) {
          if (!mounted) return;
          _searchingTimer?.cancel();
          _statePollTimer?.cancel();
          setState(() => _activeTrip = null);
        });
        _tripStatusSub = _socket.onTripStatus.listen((data) {
          if (!mounted) return;
          final status = data['status']?.toString() ?? '';
          if (status == 'completed' || status == 'cancelled') {
            _searchingTimer?.cancel();
            _statePollTimer?.cancel();
            setState(() => _activeTrip = null);
          }
        });
      });
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _loadingTimeout?.cancel();
    _servicesLoadingTimeout?.cancel();
    _bannerTimer?.cancel();
    _searchingTimer?.cancel();
    _statePollTimer?.cancel();
    _bannerPageCtrl.dispose();
    _driverAssignedSub?.cancel();
    _tripCancelledSub?.cancel();
    _tripStatusSub?.cancel();
    _nearbyDriversTimer?.cancel();
    _mapController?.dispose();
    // Don't disconnect socket — it's a shared singleton used by other screens
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive) {
      // App went to background — pause the nearby-drivers poll to save battery
      _nearbyDriversTimer?.cancel();
      _nearbyDriversTimer = null;
    } else if (state == AppLifecycleState.resumed) {
      // App came back to foreground — refresh pickup location and restart polling
      _getLocation();
      if (_nearbyDriversTimer == null) {
        _nearbyDriversTimer = Timer.periodic(
            const Duration(seconds: 10), (_) => _fetchNearbyDrivers());
        _fetchNearbyDrivers(); // refresh immediately on resume
      }
      // Previously active-trip recovery only ran once, from initState — a
      // background→foreground resume (the common case: lock screen, app
      // switcher, a phone call) never re-checked, so a booking made just
      // before backgrounding, or one whose status changed while backgrounded
      // and the socket was suspended, wouldn't be reflected until a full
      // cold restart. The backend remains the source of truth either way —
      // this just re-asks it on every resume, same as on launch.
      _checkActiveTripAndRecovery();
      _checkActiveParcel();
    }
  }

  Future<void> _loadUser() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _userName = prefs.getString('user_name') ?? 'there';
    });
  }

  Future<void> _showLocationPrompt({
    required String title,
    required String message,
    required Future<bool> Function() openSettings,
  }) async {
    if (!mounted) return;
    await showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              await openSettings();
            },
            child: const Text('Open Settings'),
          ),
        ],
      ),
    );
  }

  Future<void> _getLocation() async {
    try {
      final fallbackPosition = await Geolocator.getLastKnownPosition();
      // Fast path: a cold, high-accuracy GPS fix (below) can easily take
      // 10-60+s on a fresh install (first-time permission prompt + no
      // warm GPS lock). If the OS already has *any* last-known fix
      // cached — common even for a brand-new app install, since it's
      // often shared across apps via Google Play services — use it
      // immediately so the map/services grid isn't stuck waiting. The
      // accurate fix below still runs and overwrites this once it lands.
      if (fallbackPosition != null && mounted && !_locationReady) {
        setState(() {
          _pickupLat = fallbackPosition.latitude;
          _pickupLng = fallbackPosition.longitude;
          _locationReady = true;
          _pickup = 'Using last known location';
        });
        _reverseGeocode(fallbackPosition.latitude, fallbackPosition.longitude);
        _fetchActiveServices();
        _fetchNearbyDrivers();
      }
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (fallbackPosition != null && mounted) {
          setState(() {
            _pickupLat = fallbackPosition.latitude;
            _pickupLng = fallbackPosition.longitude;
            _locationReady = true;
            _pickup = 'Using last known location';
          });
          _reverseGeocode(
              fallbackPosition.latitude, fallbackPosition.longitude);
          _mapController?.animateCamera(
            CameraUpdate.newLatLngZoom(
              LatLng(fallbackPosition.latitude, fallbackPosition.longitude),
              15,
            ),
          );
          _fetchNearbyDrivers();
        } else if (mounted) {
          setState(() {
            _pickup = 'Turn on location services to detect pickup';
            _locationReady = false;
          });
          await _showLocationPrompt(
            title: 'Location Services Off',
            message:
                'Turn on device location so we can detect your live pickup point accurately.',
            openSettings: Geolocator.openLocationSettings,
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
          setState(() {
            _pickup = 'Location permission is needed to detect pickup';
            _locationReady = false;
          });
        }
        return;
      }
      if (perm == LocationPermission.deniedForever) {
        if (!mounted) return;
        setState(() {
          _pickup = 'Location permission is blocked. Open settings to enable it.';
          _locationReady = false;
        });
        showDialog(
          context: context,
          barrierDismissible: false,
          builder: (_) => AlertDialog(
            title: const Text('Location Required'),
            content: const Text(
                'Location access is required to request rides. Please enable it in your device settings.'),
            actions: [
              TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancel')),
              ElevatedButton(
                onPressed: () {
                  Navigator.pop(context);
                  Geolocator.openAppSettings();
                },
                child: const Text('Open Settings'),
              ),
            ],
          ),
        );
        return;
      }

      Position? pos;
      try {
        pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 10),
          ),
        );
      } catch (_) {
        pos = fallbackPosition;
      }

      if (pos == null) {
        if (mounted) {
          setState(() {
            _pickup = 'Could not detect your location. Tap to retry.';
            _locationReady = false;
          });
        }
        return;
      }

      if (mounted) {
        setState(() {
          _pickupLat = pos!.latitude;
          _pickupLng = pos.longitude;
          _locationReady = true;
          _pickup = 'Current Location'; // placeholder — overwritten by _reverseGeocode
        });
      }
      _reverseGeocode(pos.latitude, pos.longitude);
      _mapController?.animateCamera(
        CameraUpdate.newLatLngZoom(LatLng(pos.latitude, pos.longitude), 16),
      );
      _fetchNearbyDrivers();
    } catch (_) {
      // Unexpected error — try last known position before giving up
      try {
        final last = await Geolocator.getLastKnownPosition();
        if (last != null && mounted) {
          setState(() {
            _pickupLat = last.latitude;
            _pickupLng = last.longitude;
            _locationReady = true;
            _pickup = 'Current Location';
          });
          _reverseGeocode(last.latitude, last.longitude);
          _mapController?.animateCamera(
            CameraUpdate.newLatLngZoom(LatLng(last.latitude, last.longitude), 15),
          );
          _fetchNearbyDrivers();
          return;
        }
      } catch (_) {}
      if (mounted) {
        setState(() {
          _pickup = 'Tap to detect your location';
          _locationReady = false;
        });
      }
    }
  }

  Future<void> _reverseGeocode(double lat, double lng) async {
    // Try server proxy first
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.reverseGeocode}?lat=$lat&lng=$lng'),
        headers: headers,
      ).timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final addr = data['formattedAddress']?.toString() ?? '';
        if (mounted && addr.isNotEmpty) {
          setState(() => _pickup = addr);
          return;
        }
      }
    } catch (_) {}
    // Nominatim fallback — no key required
    try {
      final res = await http.get(
        Uri.parse(
            'https://nominatim.openstreetmap.org/reverse?format=json&lat=$lat&lon=$lng'),
        headers: const {'User-Agent': 'JagoPro/1.0'},
      ).timeout(const Duration(seconds: 5));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final addr = data['display_name']?.toString() ?? '';
        if (mounted && addr.isNotEmpty) {
          // Trim to first 3 components for readability
          final short = addr.split(',').take(3).join(',').trim();
          setState(() => _pickup = short.isNotEmpty ? short : 'Current Location');
          return;
        }
      }
    } catch (_) {}
    // Final fallback — keep 'Current Location' set by caller
    if (mounted && (_pickup.isEmpty)) {
      setState(() => _pickup = 'Current Location');
    }
  }

  void _handleUnauthorized() {
    AuthService.logout().then((_) {
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(context,
          MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
    });
  }

  Future<void> _fetchHome() async {
    try {
      final headers = await AuthService.getHeaders();
      final r = await http
          .get(Uri.parse(ApiConfig.customerHomeData), headers: headers)
          .timeout(const Duration(seconds: 6));
      if (r.statusCode == 401) {
        if (mounted) setState(() => _homeLoading = false);
        _handleUnauthorized();
        return;
      }
      if (r.statusCode == 200 && mounted) {
        final data = jsonDecode(r.body) as Map<String, dynamic>;
        final cats = (data['vehicleCategories'] as List<dynamic>?)
                ?.cast<Map<String, dynamic>>() ??
            [];
        setState(() => _vehicleCategories = cats);
      }
    } catch (_) {}
    if (mounted) setState(() => _homeLoading = false);
  }

  Future<void> _fetchActiveServices() async {
    // _fetchActiveServices() fires more than once per screen load (immediately
    // in initState with no location yet, again once a cached last-known
    // position lands, and again once an accurate GPS fix lands) and these
    // calls are not awaited relative to each other. Without a sequence guard,
    // an earlier call that happens to resolve *after* a later, more accurate
    // one can silently overwrite it with stale/no-location data — only the
    // most recently *issued* request is allowed to update state.
    final requestId = ++_activeServicesRequestSeq;
    final usedLat = _locationReady ? _pickupLat : null;
    final usedLng = _locationReady ? _pickupLng : null;
    try {
      final headers = await AuthService.getHeaders();
      // Use location-based endpoint for city-filtered services
      final uri =
          Uri.parse(ApiConfig.servicesForLocation).replace(queryParameters: {
        if (_locationReady) 'lat': _pickupLat.toString(),
        if (_locationReady) 'lng': _pickupLng.toString(),
      });
      final r = await http.get(uri, headers: headers);
      if (r.statusCode == 200 && mounted) {
        final data = jsonDecode(r.body) as Map<String, dynamic>;
        final services = (data['services'] as List<dynamic>?)
                ?.cast<Map<String, dynamic>>() ??
            [];
        final keys = services.map((s) => s['key']?.toString() ?? '?').toList();
        debugPrint('ACTIVE SERVICES FROM SERVER (req#$requestId, lat=$usedLat, lng=$usedLng, '
            'inZone=${data['inZone']}, zone=${data['zoneName']}): $keys');
        if (requestId != _activeServicesRequestSeq) {
          debugPrint('ACTIVE SERVICES req#$requestId superseded by req#$_activeServicesRequestSeq — discarding');
          return;
        }
        setState(() {
          _activeServices = services;
          _activeServicesDebugLine =
              'req#$requestId lat=$usedLat lng=$usedLng zone=${data['zoneName'] ?? '-'} keys=${keys.join(',')}';
          // The location-filtered endpoint returns [] with no lat/lng, so
          // only a location-aware attempt actually settles the "still
          // finding services" state — an empty unfiltered response isn't
          // a real answer yet.
          if (_locationReady) _servicesLoading = false;
        });
      }
    } catch (e) {
      debugPrint('ACTIVE SERVICES req#$requestId primary endpoint failed ($e) — falling back');
      // Fallback to non-location endpoint
      try {
        final headers = await AuthService.getHeaders();
        final r = await http.get(Uri.parse(ApiConfig.activeServices),
            headers: headers);
        if (r.statusCode == 200 && mounted) {
          final data = jsonDecode(r.body) as Map<String, dynamic>;
          final services = (data['services'] as List<dynamic>?)
                  ?.cast<Map<String, dynamic>>() ??
              [];
          final keys = services.map((s) => s['key']?.toString() ?? '?').toList();
          debugPrint('ACTIVE SERVICES FROM SERVER (req#$requestId, fallback endpoint): $keys');
          if (requestId != _activeServicesRequestSeq) {
            debugPrint('ACTIVE SERVICES req#$requestId (fallback) superseded by req#$_activeServicesRequestSeq — discarding');
            return;
          }
          setState(() {
            _activeServices = services;
            _activeServicesDebugLine = 'req#$requestId (fallback) keys=${keys.join(',')}';
            _servicesLoading = false;
          });
        }
      } catch (_) {}
    }
  }

  bool _isPlatformServiceActive(String key) {
    return _activeServices.any((s) => s['key']?.toString() == key);
  }





  void _showAllServicesStaticSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => _StaticAllServicesSheet(
        pickup: _pickup,
        pickupLat: _pickupLat,
        pickupLng: _pickupLng,
        vehicleCategories: _vehicleCategories,
        activeServices: _activeServices,
      ),
    );
  }


  @override
  Widget build(BuildContext context) {
    const isDark = false;
    final screenWidth = MediaQuery.of(context).size.width;
    final gridRatio = screenWidth < 380 ? 2.5 : (screenWidth > 600 ? 3.4 : 2.7);
    final textScale = screenWidth < 380 ? 0.9 : 1.0;

    return Scaffold(
      backgroundColor: Colors.white, // White base — no colored strip at bottom ever
      body: SafeArea(
        child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Greeting
                  Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        "Hello ${_userName == 'there' ? 'there' : _userName.split(' ').first},",
                        style: GoogleFonts.poppins(
                          fontSize: 22,
                          fontWeight: FontWeight.w500,
                          color: JT.textPrimary,
                        ),
                      ),
                      Text(
                        "Where to go?",
                        style: GoogleFonts.poppins(
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF2563EB),
                        ),
                      ),
                    ],
                  ),
                ),
                
                _buildBannerCarousel(isDark),
                
                // Destination Block
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4)),
                      ],
                    ),
                    child: Stack(
                      alignment: Alignment.centerRight,
                      children: [
                        Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // From
                            GestureDetector(
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PremiumLocationScreen(serviceType: 'ride', pickupAddress: _pickup.isNotEmpty ? _pickup : null, pickupLat: _pickupLat, pickupLng: _pickupLng))),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                child: Row(
                                  children: [
                                    const Icon(Icons.location_on, color: Color(0xFF10B981), size: 20),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          const Text("From", style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
                                          const SizedBox(height: 2),
                                          Text(
                                            _pickup.isNotEmpty ? (_pickup.contains(',') ? _pickup.split(',').first : _pickup) : "Current Location",
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: const Color(0xFF1E293B)),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(width: 40), // Spacing for the right button
                                  ],
                                ),
                              ),
                            ),
                            Divider(height: 1, thickness: 1, color: const Color(0xFFE2E8F0), indent: 48, endIndent: 16),
                            // To
                            GestureDetector(
                              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PremiumLocationScreen(serviceType: 'ride', pickupAddress: _pickup.isNotEmpty ? _pickup : null, pickupLat: _pickupLat, pickupLng: _pickupLng))),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                                child: Row(
                                  children: [
                                    const Icon(Icons.location_on, color: Color(0xFFEF4444), size: 20),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          const Text("To", style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8))),
                                          const SizedBox(height: 2),
                                          Text(
                                            "Where are you going?",
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: const Color(0xFF1E293B)),
                                          ),
                                        ],
                                      ),
                                    ),
                                    const SizedBox(width: 40),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                        // Swap / Action button on right
                        Positioned(
                          right: 16,
                          child: GestureDetector(
                            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PremiumLocationScreen(serviceType: 'ride', pickupAddress: _pickup.isNotEmpty ? _pickup : null, pickupLat: _pickupLat, pickupLng: _pickupLng))),
                            child: Container(
                              width: 36,
                              height: 36,
                              decoration: BoxDecoration(
                                color: const Color(0xFFF1F5F9),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.swap_vert_rounded, color: Color(0xFF3B48D1), size: 20),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                
                const SizedBox(height: 16),
                
                // Action Buttons (Modern Rectangle Cards)
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Row(
                    children: [
                      // Book a Ride
                      Expanded(
                        child: GestureDetector(
                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PremiumLocationScreen(serviceType: 'ride', pickupAddress: _pickup.isNotEmpty ? _pickup : null, pickupLat: _pickupLat, pickupLng: _pickupLng))),
                          child: Container(
                            height: 120, // Reduced height for more compact look
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(colors: [Color(0xFF2563EB), Color(0xFF1D4ED8)], begin: Alignment.topLeft, end: Alignment.bottomRight),
                              borderRadius: BorderRadius.circular(16),
                              boxShadow: [
                                BoxShadow(color: const Color(0xFF2563EB).withValues(alpha: 0.3), blurRadius: 12, offset: const Offset(0, 4)),
                              ],
                            ),
                            child: Stack(
                              children: [
                                // Text at the top
                                Positioned(
                                  top: 14, left: 16,
                                  child: SizedBox(
                                    width: (screenWidth / 2) - 60,
                                    child: FittedBox(
                                      alignment: Alignment.centerLeft,
                                      fit: BoxFit.scaleDown,
                                      child: Text("Book a Ride", style: TextStyle(color: Colors.white, fontSize: 16 * textScale, fontWeight: FontWeight.w900)),
                                    ),
                                  ),
                                ),
                                // Brand image on the left
                                Positioned(
                                  bottom: -8, left: -8,
                                  child: CachedNetworkImage(
                                    imageUrl: 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1775370325/04bcf87d-433e-4508-b475-78eaee34ff98_qxbn2c.png',
                                    height: 85,
                                    fit: BoxFit.contain,
                                    placeholder: (_, __) => const SizedBox.shrink(),
                                    errorWidget: (_, __, ___) => const SizedBox.shrink(),
                                  ),
                                ),
                                // 3D Car Image on the right
                                Positioned(
                                  bottom: 10, right: 10,
                                  child: CachedNetworkImage(
                                    imageUrl: 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1775129355/ChatGPT_Image_Apr_2_2026_04_59_00_PM_rlsvjz.png',
                                    height: 80,
                                    fit: BoxFit.contain,
                                    placeholder: (_, __) => const SizedBox.shrink(),
                                    errorWidget: (_, __, ___) => const SizedBox.shrink(),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 14),
                      // Send Parcel
                      Expanded(
                        child: GestureDetector(
                          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ParcelBookingScreen(pickupAddress: _pickup, pickupLat: _pickupLat, pickupLng: _pickupLng))),
                          child: Container(
                            height: 120, // Matching reduced height
                            decoration: BoxDecoration(
                              gradient: const LinearGradient(colors: [Color(0xFFC29763), Color(0xFFD6B58F)], begin: Alignment.topLeft, end: Alignment.bottomRight),
                              borderRadius: BorderRadius.circular(16), 
                              boxShadow: [
                                BoxShadow(color: const Color(0xFFC29763).withValues(alpha: 0.3), blurRadius: 12, offset: const Offset(0, 4)),
                              ],
                            ),
                            child: Stack(
                              children: [
                                // Text at the top
                                Positioned(
                                  top: 14, left: 16,
                                  child: SizedBox(
                                    width: (screenWidth / 2) - 60,
                                    child: FittedBox(
                                      alignment: Alignment.centerLeft,
                                      fit: BoxFit.scaleDown,
                                      child: Text("Send Parcel", style: TextStyle(color: Colors.white, fontSize: 16 * textScale, fontWeight: FontWeight.w900)),
                                    ),
                                  ),
                                ),
                                // Delivery image on the left side
                                Positioned(
                                  bottom: -8, left: -8,
                                  child: CachedNetworkImage(
                                    imageUrl: 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1775367404/be5b86c2-7a8a-4dbd-ad33-e8da2b627d5e_vurdrg.png',
                                    height: 85,
                                    fit: BoxFit.contain,
                                    placeholder: (_, __) => const SizedBox.shrink(),
                                    errorWidget: (_, __, ___) => const SizedBox.shrink(),
                                  ),
                                ),
                                // 3D Gift/Box Image on the right
                                Positioned(
                                  bottom: 10, right: 10,
                                  child: CachedNetworkImage(
                                    imageUrl: 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1775128882/ChatGPT_Image_Apr_2_2026_04_47_08_PM_zg8llx.png',
                                    height: 75,
                                    fit: BoxFit.contain,
                                    placeholder: (_, __) => const SizedBox.shrink(),
                                    errorWidget: (_, __, ___) => const SizedBox.shrink(),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                
                const SizedBox(height: 16),
                
                // Our Services Header
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Row(
                    children: [
                      const Text("Our Services", style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: Color(0xFF1E293B), letterSpacing: -0.5)),
                      if (_servicesLoading) ...[
                        const SizedBox(width: 10),
                        const SizedBox(
                          width: 13,
                          height: 13,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF2C95F1)),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            "Finding services near you…",
                            style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF64748B)),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),

                // TEMP diagnostic readout — shows exactly what the active-services
                // API returned so the Cab/Premium visibility issue can be
                // diagnosed on an installed release build without ADB. Remove
                // once resolved.
                if (_activeServicesDebugLine.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 4, 20, 0),
                    child: Text(
                      _activeServicesDebugLine,
                      style: const TextStyle(fontSize: 10, color: Color(0xFFEF4444)),
                    ),
                  ),

                const SizedBox(height: 12),

                // Our Services Grid
                GridView.count(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                  crossAxisCount: 2,
                  childAspectRatio: gridRatio, // Responsive ratio based on screen width
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 10,
                  children: _buildHomeServiceGridChildren(textScale, screenWidth),
                    ),
                  // Removed Extra ) for Expanded

                  // Active trip banner
                  if (_activeTrip != null) ...[
                    const SizedBox(height: 12),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _buildActiveTripBanner(false),
                    ),
                  ],
                  if (_activeTrip == null && _activeParcel != null) ...[
                    const SizedBox(height: 12),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _buildActiveParcelBanner(),
                    ),
                  ],
                  if (_activeTrip == null && _activeParcel == null && _activePoolBooking != null) ...[
                    const SizedBox(height: 12),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _buildActivePoolBanner(),
                    ),
                  ],
                  if (_activeTrip == null && _activeParcel == null && _activePoolBooking == null && _activeOutstationBooking != null) ...[
                    const SizedBox(height: 12),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _buildActiveOutstationBanner(),
                    ),
                  ],

                  const SizedBox(height: 32),
                    
                  // Jago City Watermark Banner - asset not yet supplied by
                  // design; collapses to nothing rather than showing a
                  // developer-facing placeholder message to real users.
                  Image.asset(
                    'assets/images/jago_city_banner.png',
                    width: double.infinity,
                    fit: BoxFit.fitWidth,
                    errorBuilder: (context, error, stackTrace) =>
                        const SizedBox.shrink(),
                  ),

                  // Add padding at the bottom of the scroll view
                  const SizedBox(height: 20),
                ],
              ),
            ),
      ),
    );
  }


  bool _isHomeServiceVisible(String serviceKey) {
    if (_activeServices.isEmpty) {
      return serviceKey == 'bike_ride' || serviceKey == 'parcel_delivery';
    }
    return _activeServices.any((s) => s['key']?.toString() == serviceKey);
  }



  Widget _homeServiceTile({
    required String label,
    required String vehicleKey,
    String? imageUrl,
    required VoidCallback onTap,
    double labelFontSize = 14,
    double artworkWidth = 76,
    double artworkRight = -6,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: JT.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: JT.border, width: 1),
          boxShadow: JT.cardShadow,
        ),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 14,
              top: 0,
              bottom: 0,
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  label,
                  style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontSize: labelFontSize,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
            Positioned(
              right: artworkRight,
              top: -6,
              bottom: -6,
              child: imageUrl != null
                  ? CachedNetworkImage(
                      imageUrl: imageUrl,
                      width: artworkWidth,
                      fit: BoxFit.contain,
                      placeholder: (_, __) => const SizedBox.shrink(),
                      errorWidget: (_, __, ___) => const SizedBox.shrink(),
                    )
                  : VehicleArtwork(vehicleKey: vehicleKey, width: artworkWidth),
            ),
          ],
        ),
      ),
    );
  }

  Widget _homeViewAllTile(double textScale) {
    return GestureDetector(
      onTap: _showAllServicesStaticSheet,
      child: Container(
        decoration: BoxDecoration(
          color: JT.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: JT.border, width: 1),
          boxShadow: JT.cardShadow,
        ),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned(
              left: 14,
              top: 0,
              bottom: 0,
              child: Center(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    'View All',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF1E293B),
                      fontSize: 14 * textScale,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              right: 10,
              top: 0,
              bottom: 0,
              child: Icon(Icons.arrow_forward_rounded,
                  color: const Color(0xFF2C95F1), size: 24),
            ),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildHomeServiceGridChildren(double textScale, double screenWidth) {
    final tiles = <Widget>[];
    void addTile(String serviceKey, Widget tile) {
      if (_isHomeServiceVisible(serviceKey)) tiles.add(tile);
    }

    addTile(
      'bike_ride',
      _homeServiceTile(
        label: 'Bike',
        vehicleKey: 'bike',
        imageUrl: 'https://res.cloudinary.com/kits/image/upload/e_make_transparent:15/q_auto/f_png/v1775123974/bike_logo_g7idrq.png',
        labelFontSize: 14 * textScale,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PremiumLocationScreen(
              serviceType: 'ride',
              vehicleCategoryName: 'Bike',
              pickupAddress: _pickup.isNotEmpty ? _pickup : null,
              pickupLat: _pickupLat,
              pickupLng: _pickupLng,
            ),
          ),
        ),
      ),
    );
    addTile(
      'auto_ride',
      _homeServiceTile(
        label: 'Auto',
        vehicleKey: 'auto',
        imageUrl: 'https://res.cloudinary.com/kits/image/upload/q_auto/f_auto/v1775125550/ChatGPT_Image_Apr_2_2026_03_55_30_PM_ywb7fj.png',
        labelFontSize: 14 * textScale,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PremiumLocationScreen(
              serviceType: 'ride',
              vehicleCategoryName: 'Auto',
              pickupAddress: _pickup.isNotEmpty ? _pickup : null,
              pickupLat: _pickupLat,
              pickupLng: _pickupLng,
            ),
          ),
        ),
      ),
    );
    addTile(
      'mini_car',
      _homeServiceTile(
        label: 'Cab',
        vehicleKey: 'cab',
        imageUrl: 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_27_28_AM_w0rcnh',
        labelFontSize: 14 * textScale,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PremiumLocationScreen(
              serviceType: 'ride',
              vehicleCategoryName: 'Cab',
              pickupAddress: _pickup.isNotEmpty ? _pickup : null,
              pickupLat: _pickupLat,
              pickupLng: _pickupLng,
            ),
          ),
        ),
      ),
    );
    addTile(
      'sedan',
      _homeServiceTile(
        label: 'Premium',
        vehicleKey: 'premium',
        imageUrl: 'https://res.cloudinary.com/dg5ct7fys/image/upload/f_auto,q_auto/ChatGPT_Image_Apr_17_2026_11_31_05_AM_kavp5e',
        labelFontSize: 12 * textScale,
        artworkWidth: 72,
        artworkRight: -8,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PremiumLocationScreen(
              serviceType: 'ride',
              vehicleCategoryName: 'Premium',
              pickupAddress: _pickup.isNotEmpty ? _pickup : null,
              pickupLat: _pickupLat,
              pickupLng: _pickupLng,
            ),
          ),
        ),
      ),
    );
    addTile(
      'parcel_delivery',
      _homeServiceTile(
        label: 'Parcel',
        vehicleKey: 'parcel_bike',
        imageUrl: 'https://res.cloudinary.com/kits/image/upload/q_auto/f_auto/v1775367404/be5b86c2-7a8a-4dbd-ad33-e8da2b627d5e_vurdrg.png',
        labelFontSize: 14 * textScale,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ParcelBookingScreen(
              pickupAddress: _pickup,
              pickupLat: _pickupLat,
              pickupLng: _pickupLng,
            ),
          ),
        ),
      ),
    );

    if (_isPlatformServiceActive('city_pool')) {
      tiles.add(_homeServiceTile(
        label: 'Car Share',
        vehicleKey: 'car_share',
        imageUrl: 'https://res.cloudinary.com/kits/image/upload/v1784527865/car_sharing_vo8nrz.png',
        labelFontSize: 12 * textScale,
        // Real seat-sharing: reuses the same pickup/drop picker as every
        // other tile, then hands off to the Rolling Pool booking flow
        // (member count -> vehicle type -> live per-seat price -> confirm)
        // instead of a private single-vehicle booking.
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => PremiumLocationScreen(
              serviceType: 'ride',
              pickupAddress: _pickup.isNotEmpty ? _pickup : null,
              pickupLat: _pickupLat,
              pickupLng: _pickupLng,
              onLocationsConfirmed: (pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng) {
                Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                    builder: (_) => CarShareOptionsScreen(
                      pickupAddress: pickupAddress,
                      pickupLat: pickupLat,
                      pickupLng: pickupLng,
                      dropAddress: dropAddress,
                      dropLat: dropLat,
                      dropLng: dropLng,
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      ));
    }
    if (_isPlatformServiceActive('outstation_pool') ||
        _isPlatformServiceActive('intercity_pool')) {
      tiles.add(_homeServiceTile(
        label: 'Outstation',
        vehicleKey: 'outstation',
        imageUrl: 'https://res.cloudinary.com/kits/image/upload/v1784528307/outstation_pool_qh48ii.png',
        labelFontSize: 12 * textScale,
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const OutstationPoolScreen()),
        ),
      ));
    }

    if (tiles.isNotEmpty) {
      tiles.add(_homeViewAllTile(textScale));
    }
    return tiles;
  }


  // ── BANNER CAROUSEL ───────────────────────────────────────────────────────
  Widget _buildBannerCarousel(bool isDark) {
    if (_banners.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
      child: Column(children: [
              SizedBox(
                height: 140,
                child: PageView.builder(
                  controller: _bannerPageCtrl,
                  onPageChanged: (i) => setState(() => _bannerIndex = i),
                  itemCount: _banners.length,
                  itemBuilder: (_, i) {
                    final b = _banners[i];
                    final imgUrl = b['image_url']?.toString() ?? '';
                    return Container(
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        color: Colors.white,
                        border: Border.all(color: const Color(0xFFDCE7F5)),
                        boxShadow: JT.cardShadow,
                      ),
                      child: imgUrl.isNotEmpty
                          ? ClipRRect(
                              borderRadius: BorderRadius.circular(16),
                              child: Image.network(imgUrl,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, __, ___) =>
                                      _bannerPlaceholder(b)))
                          : _bannerPlaceholder(b),
                    );
                  },
                ),
              ),
              if (_banners.length > 1) ...[
                const SizedBox(height: 8),
                Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                        _banners.length,
                        (i) => Container(
                              margin: const EdgeInsets.symmetric(horizontal: 3),
                              width: _bannerIndex == i ? 16 : 6,
                              height: 6,
                              decoration: BoxDecoration(
                                color: _bannerIndex == i
                                    ? JT.primary
                                    : JT.primary.withValues(alpha: 0.3),
                                borderRadius: BorderRadius.circular(3),
                              ),
                            ))),
              ],
            ]),
    );
  }

  Widget _bannerPlaceholder(Map<String, dynamic> b) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        color: JT.primary,
      ),
      child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(b['title']?.toString() ?? 'Special Offer',
                style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w400)),
            const SizedBox(height: 4),
            Text('Tap to learn more',
                style:
                    GoogleFonts.poppins(color: Colors.white70, fontSize: 12)),
          ]),
    );
  }


  // ── ACTIVE TRIP BANNER ───────────────────────────────────────────────────
  Widget _buildActiveTripBanner(bool isDark) {
    final trip = _activeTrip!;
    final status = trip['currentStatus']?.toString() ?? 'accepted';
    final tripId = trip['id']?.toString() ?? '';
    final driverName = trip['driverName']?.toString() ?? 'your Pilot';
    final dest = trip['destinationAddress']?.toString() ?? 'destination';
    final isSearching = status == 'searching';

    final statusLabel = {
          'searching': 'Finding a Pilot...',
          'accepted': 'Pilot is on the way',
          'driver_assigned': 'Pilot assigned',
          'arrived': 'Pilot has arrived!',
          'in_progress': 'Ride in progress',
        }[status] ??
        'Ride active';

    final isArrived = status == 'arrived';
    final bannerColor = isSearching
        ? JT.primaryDark
        : isArrived
            ? const Color(0xFF1A6FDB)
            : JT.primary;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: bannerColor.withValues(alpha: 0.20)),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 16,
              offset: const Offset(0, 4))
        ],
      ),
      child: Row(children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
              color: bannerColor.withValues(alpha: 0.10),
              shape: BoxShape.circle),
          child: Icon(
              isSearching ? Icons.search_rounded : Icons.navigation_rounded,
              color: bannerColor,
              size: 22),
        ),
        const SizedBox(width: 12),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(statusLabel,
              style: GoogleFonts.poppins(
                  color: JT.textPrimary,
                  fontWeight: FontWeight.w500,
                  fontSize: 14)),
          Text(
              isSearching
                  ? 'Looking for nearby pilots...'
                  : '$driverName → ${dest.length > 28 ? '${dest.substring(0, 26)}...' : dest}',
              style: GoogleFonts.poppins(
                  color: JT.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w500)),
        ])),
        if (isSearching) ...[
          GestureDetector(
            onTap: () {
              if (tripId.isEmpty) return;
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(builder: (_) => TrackingScreen(tripId: tripId)),
              );
            },
            child: Container(
              margin: const EdgeInsets.only(right: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: JT.primary.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text('Track →',
                  style: GoogleFonts.poppins(
                      color: JT.primary,
                      fontWeight: FontWeight.w400,
                      fontSize: 12)),
            ),
          ),
          GestureDetector(
            onTap: () async {
              final confirm = await showDialog<bool>(
                context: context,
                builder: (ctx) => AlertDialog(
                  backgroundColor: JT.surface,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                  title: Text('Cancel Ride?',
                      style: GoogleFonts.poppins(
                          fontWeight: FontWeight.w400,
                          color: JT.textPrimary,
                          fontSize: 16)),
                  content: Text(
                      'No pilot found yet. Do you want to cancel this request?',
                      style: GoogleFonts.poppins(
                          color: JT.textSecondary, fontSize: 13)),
                  actions: [
                    TextButton(
                        onPressed: () => Navigator.pop(ctx, false),
                        child: Text('Wait',
                            style:
                                GoogleFonts.poppins(color: JT.textSecondary))),
                    ElevatedButton(
                        style: ElevatedButton.styleFrom(
                            backgroundColor: JT.primaryDark,
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10))),
                        onPressed: () => Navigator.pop(ctx, true),
                        child: Text('Cancel Ride',
                            style: GoogleFonts.poppins(
                                fontWeight: FontWeight.w500))),
                  ],
                ),
              );
              if (confirm == true && mounted) {
                try {
                  final h = await AuthService.getHeaders();
                  await http.post(Uri.parse(ApiConfig.cancelTrip),
                      headers: h,
                      body: jsonEncode(
                          {'tripId': tripId, 'reason': 'No pilot found'}));
                } catch (_) {}
                if (mounted) setState(() => _activeTrip = null);
              }
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: JT.primaryDark.withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text('Cancel',
                  style: GoogleFonts.poppins(
                      color: JT.primaryDark,
                      fontWeight: FontWeight.w400,
                      fontSize: 12)),
            ),
          ),
        ] else
          GestureDetector(
            onTap: () {
              if (tripId.isEmpty) return;
              Navigator.pushReplacement(
                  context,
                  MaterialPageRoute(
                      builder: (_) => TrackingScreen(tripId: tripId)));
            },
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
              decoration: BoxDecoration(
                color: JT.primary.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text('Track →',
                  style: GoogleFonts.poppins(
                      color: JT.primary,
                      fontWeight: FontWeight.w400,
                      fontSize: 12)),
            ),
          ),
      ]),
    );
  }

  Widget _buildActiveParcelBanner() {
    final parcel = _activeParcel!;
    final status = parcel['currentStatus']?.toString() ?? 'searching';
    final orderId = parcel['id']?.toString() ?? '';
    final driverName = parcel['driverName']?.toString() ?? 'delivery partner';
    final dest = parcel['dropAddress']?.toString() ??
        parcel['destinationAddress']?.toString() ??
        'destination';
    final isSearching = status == 'searching' || status == 'pending';
    final bannerColor = isSearching ? JT.primaryDark : JT.primary;

    final statusLabel = {
          'searching': 'Finding delivery partner...',
          'pending': 'Finding delivery partner...',
          'driver_assigned': 'Partner assigned',
          'accepted': 'Partner heading to pickup',
          'picked_up': 'Parcel picked up',
          'in_transit': 'Parcel on the way',
        }[status] ??
        'Parcel active';

    return Container(
      margin: const EdgeInsets.fromLTRB(0, 0, 0, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: bannerColor.withValues(alpha: 0.20)),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 16,
              offset: const Offset(0, 4))
        ],
      ),
      child: Row(children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
              color: bannerColor.withValues(alpha: 0.10),
              shape: BoxShape.circle),
          child: Icon(
              isSearching ? Icons.search_rounded : Icons.local_shipping_rounded,
              color: bannerColor,
              size: 22),
        ),
        const SizedBox(width: 12),
        Expanded(
            child:
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(statusLabel,
              style: GoogleFonts.poppins(
                  color: JT.textPrimary,
                  fontWeight: FontWeight.w500,
                  fontSize: 14)),
          Text(
              isSearching
                  ? 'Looking for nearby partners...'
                  : '$driverName → ${dest.length > 28 ? '${dest.substring(0, 26)}...' : dest}',
              style: GoogleFonts.poppins(
                  color: JT.textSecondary,
                  fontSize: 11,
                  fontWeight: FontWeight.w500)),
        ])),
        GestureDetector(
          onTap: () {
            if (orderId.isEmpty) return;
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(
                builder: (_) => TrackingScreen(tripId: orderId, isParcel: true),
              ),
            );
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(
              color: bannerColor.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text('Track →',
                style: GoogleFonts.poppins(
                    color: bannerColor,
                    fontWeight: FontWeight.w400,
                    fontSize: 12)),
          ),
        ),
      ]),
    );
  }

  Widget _buildActivePoolBanner() {
    final booking = _activePoolBooking!;
    final status = booking['status']?.toString() ?? 'searching';
    final requestId = booking['id']?.toString() ?? '';
    final driverName = booking['driverName']?.toString() ?? booking['driver_name']?.toString() ?? '';
    final pickup = booking['pickupAddress']?.toString() ?? booking['pickup_address']?.toString() ?? 'pickup';
    final drop = booking['dropAddress']?.toString() ?? booking['drop_address']?.toString() ?? 'destination';
    final isSearching = status == 'searching';
    final bannerColor = isSearching ? JT.primaryDark : JT.primary;

    final statusLabel = {
          'searching': 'Finding your Car Share driver...',
          'pending_driver_accept': 'Confirming your driver...',
          'matched': 'Driver matched',
          'picked_up': 'Car Share trip in progress',
        }[status] ??
        'Car Share active';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: bannerColor.withValues(alpha: 0.20)),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 16, offset: const Offset(0, 4))
        ],
      ),
      child: Row(children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: bannerColor.withValues(alpha: 0.10), shape: BoxShape.circle),
          child: Icon(isSearching ? Icons.search_rounded : Icons.groups_rounded, color: bannerColor, size: 22),
        ),
        const SizedBox(width: 12),
        Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(statusLabel, style: GoogleFonts.poppins(color: JT.textPrimary, fontWeight: FontWeight.w500, fontSize: 14)),
          Text(
              isSearching
                  ? '$pickup → $drop'
                  : '${driverName.isNotEmpty ? '$driverName · ' : ''}$pickup → $drop',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 11, fontWeight: FontWeight.w500)),
        ])),
        GestureDetector(
          onTap: () {
            if (requestId.isEmpty) return;
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => LocalPoolStatusScreen(requestId: requestId, pickupAddress: pickup, dropAddress: drop),
              ),
            );
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(color: bannerColor.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10)),
            child: Text('Track →', style: GoogleFonts.poppins(color: bannerColor, fontWeight: FontWeight.w400, fontSize: 12)),
          ),
        ),
      ]),
    );
  }

  Widget _buildActiveOutstationBanner() {
    final booking = _activeOutstationBooking!;
    final status = booking['status']?.toString() ?? 'confirmed';
    final fromCity = booking['fromCity']?.toString() ?? booking['from_city']?.toString() ?? 'origin';
    final toCity = booking['toCity']?.toString() ?? booking['to_city']?.toString() ?? 'destination';
    final seats = booking['seatsBooked'] ?? booking['seats_booked'];
    final bookingMode = booking['bookingMode']?.toString() ?? booking['booking_mode']?.toString() ?? 'seat';
    final driverName = booking['driverName']?.toString() ?? booking['driver_name']?.toString() ?? '';
    final isOngoing = status == 'picked_up';
    final bannerColor = isOngoing ? JT.primary : JT.primaryDark;
    final modeLabel = bookingMode == 'whole_car' ? 'Whole Car' : (seats != null ? '$seats seat${seats.toString() == '1' ? '' : 's'}' : '');

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: bannerColor.withValues(alpha: 0.20)),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 16, offset: const Offset(0, 4))
        ],
      ),
      child: Row(children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(color: bannerColor.withValues(alpha: 0.10), shape: BoxShape.circle),
          child: Icon(isOngoing ? Icons.directions_car_rounded : Icons.alt_route_rounded, color: bannerColor, size: 22),
        ),
        const SizedBox(width: 12),
        Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(isOngoing ? 'Intercity trip in progress' : 'Intercity booking confirmed',
              style: GoogleFonts.poppins(color: JT.textPrimary, fontWeight: FontWeight.w500, fontSize: 14)),
          Text(
              '$fromCity → $toCity${modeLabel.isNotEmpty ? ' · $modeLabel' : ''}${driverName.isNotEmpty ? ' · $driverName' : ''}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 11, fontWeight: FontWeight.w500)),
        ])),
        GestureDetector(
          onTap: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const OutstationPoolScreen(initialTab: 1)),
            );
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(color: bannerColor.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(10)),
            child: Text('Track →', style: GoogleFonts.poppins(color: bannerColor, fontWeight: FontWeight.w400, fontSize: 12)),
          ),
        ),
      ]),
    );
  }

}

class _StaticAllServicesSheet extends StatelessWidget {
  final String pickup;
  final double pickupLat;
  final double pickupLng;
  final List<Map<String, dynamic>> vehicleCategories;
  final List<Map<String, dynamic>> activeServices;

  const _StaticAllServicesSheet({
    required this.pickup,
    required this.pickupLat,
    required this.pickupLng,
    required this.vehicleCategories,
    required this.activeServices,
  });

  List<Map<String, dynamic>> _visibleServices() {
    const all = [
      {'name': 'JAGO Bike', 'imageUrl': 'https://res.cloudinary.com/dg5ct7fys/image/upload/e_make_transparent:15/q_auto/f_png/v1780037646/ChatGPT_Image_May_29_2026_12_22_50_PM_rhxgf4.png', 'type': 'ride', 'cat': 'Bike', 'serviceKey': 'bike_ride'},
      {'name': 'JAGO Auto', 'imageUrl': 'https://res.cloudinary.com/dg5ct7fys/image/upload/e_make_transparent:15/q_auto/f_png/v1780037799/ChatGPT_Image_May_29_2026_12_26_23_PM_gr1npy.png', 'type': 'ride', 'cat': 'Auto', 'serviceKey': 'auto_ride'},
      {'name': 'JAGO Mini', 'imageUrl': 'https://res.cloudinary.com/dg5ct7fys/image/upload/e_make_transparent:15/q_auto/f_png/v1780037873/ChatGPT_Image_May_29_2026_12_27_19_PM_sbimsr.png', 'type': 'ride', 'cat': 'Mini', 'serviceKey': 'mini_car'},
      {'name': 'JAGO Sedan', 'imageUrl': 'https://res.cloudinary.com/dg5ct7fys/image/upload/e_make_transparent:15/q_auto/f_png/v1780038163/ChatGPT_Image_May_29_2026_12_31_37_PM_ys5bjt.png', 'type': 'ride', 'cat': 'Sedan', 'serviceKey': 'sedan'},
      {'name': 'JAGO SUV', 'imageUrl': 'https://res.cloudinary.com/dg5ct7fys/image/upload/e_make_transparent:15/q_auto/f_png/v1780038163/ChatGPT_Image_May_29_2026_12_31_37_PM_ys5bjt.png', 'type': 'ride', 'cat': 'SUV', 'serviceKey': 'suv'},
      {'name': 'JAGO Share', 'imageUrl': 'https://res.cloudinary.com/dg5ct7fys/image/upload/e_make_transparent:15/q_auto/f_png/v1780038580/ChatGPT_Image_May_29_2026_12_39_20_PM_s8j1bs.png', 'type': 'ride', 'cat': 'Share', 'serviceKey': 'city_pool'},
      {'name': 'JAGO Parcel', 'imageUrl': 'https://res.cloudinary.com/kits/image/upload/v1775367404/be5b86c2-7a8a-4dbd-ad33-e8da2b627d5e_vurdrg.png', 'type': 'parcel', 'cat': 'Parcel', 'serviceKey': 'parcel_delivery'},
      {'name': 'JAGO Outstation', 'imageUrl': 'https://res.cloudinary.com/dg5ct7fys/image/upload/e_make_transparent:15/q_auto/f_png/v1780038697/ChatGPT_Image_May_29_2026_12_41_11_PM_xoynqv.png', 'type': 'ride', 'cat': 'Outstation', 'serviceKey': 'outstation_pool'},
      {'name': 'JAGO Prime', 'imageUrl': 'https://res.cloudinary.com/dg5ct7fys/image/upload/e_make_transparent:15/q_auto/f_png/v1780038792/ChatGPT_Image_May_29_2026_12_42_56_PM_kjtvzj.png', 'type': 'ride', 'cat': 'Prime', 'serviceKey': 'sedan'},
    ];
    final activeKeys = activeServices
        .map((s) => s['key']?.toString() ?? '')
        .where((k) => k.isNotEmpty)
        .toSet();
    if (activeKeys.isEmpty) {
      return all
          .where((s) => s['serviceKey'] == 'bike_ride' || s['serviceKey'] == 'parcel_delivery')
          .map((s) => Map<String, dynamic>.from(s))
          .toList();
    }
    return all
        .where((s) => activeKeys.contains(s['serviceKey']?.toString()))
        .map((s) => Map<String, dynamic>.from(s))
        .toList();
  }

  @override
  Widget build(BuildContext context) {
    final services = _visibleServices();

    return Container(
      padding: const EdgeInsets.only(top: 16, left: 16, right: 16, bottom: 24),
      decoration: const BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 36,
            height: 4,
            decoration: BoxDecoration(
              color: JT.primaryLight,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 16),
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            Text('All Services',
                style: GoogleFonts.poppins(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: JT.textPrimary)),
            GestureDetector(
              onTap: () => Navigator.pop(context),
              child: Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: JT.surfaceAlt,
                  shape: BoxShape.circle,
                ),
                child: Icon(Icons.close, size: 18, color: JT.textTertiary),
              ),
            ),
          ]),
          const SizedBox(height: 20),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              childAspectRatio: 0.88,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
            ),
            itemCount: services.length,
            itemBuilder: (_, i) {
              final s = services[i];
              return GestureDetector(
                onTap: () {
                  Navigator.pop(context);
                  if (s['type'] == 'parcel') {
                    Navigator.push(context, MaterialPageRoute(builder: (_) => ParcelBookingScreen(
                      pickupAddress: pickup,
                      pickupLat: pickupLat,
                      pickupLng: pickupLng,
                    )));
                  } else {
                    final catName = (s['cat'] as String).toLowerCase();
                    final matchingDbCat = vehicleCategories.firstWhere(
                      (dbCat) => (dbCat['name']?.toString() ?? '').toLowerCase().contains(catName),
                      orElse: () => <String, dynamic>{},
                    );

                    Navigator.push(context, MaterialPageRoute(builder: (_) => PremiumLocationScreen(
                      serviceType: 'ride',
                      pickupAddress: pickup.isNotEmpty ? pickup : null,
                      pickupLat: pickupLat,
                      pickupLng: pickupLng,
                      vehicleCategoryId: matchingDbCat['id']?.toString(),
                      vehicleCategoryName: s['cat'] as String,
                    )));
                  }
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                  decoration: BoxDecoration(
                    color: JT.surfaceAlt,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: JT.border),
                    boxShadow: JT.cardShadow,
                  ),
                  child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    SizedBox(
                      width: 64,
                      height: 48,
                      child: s.containsKey('imageUrl')
                          ? CachedNetworkImage(
                              imageUrl: s['imageUrl'] as String,
                              fit: BoxFit.contain,
                              placeholder: (_, __) => const SizedBox.shrink(),
                              errorWidget: (_, __, ___) => const SizedBox.shrink(),
                            )
                          : VehicleArtwork(
                              vehicleKey: s['vehicleKey']?.toString() ?? 'bike',
                              height: 48,
                            ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      s['name'] as String,
                      style: GoogleFonts.poppins(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: JT.textPrimary),
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ]),
                ),
              );
            },
          ),
        ]),
      ),
    );
  }
}

// Tutorial tip row widget used in the first-visit tutorial overlay
class _TutorialTip extends StatelessWidget {
  final String icon;
  final String title;
  final String desc;
  const _TutorialTip(
      {required this.icon, required this.title, required this.desc});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: const Color(0xFFEFF6FF),
            borderRadius: BorderRadius.circular(12),
          ),
          child:
              Center(child: Text(icon, style: const TextStyle(fontSize: 20))),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title,
                  style: GoogleFonts.poppins(
                      fontWeight: FontWeight.w500,
                      fontSize: 13,
                      color: JT.textPrimary)),
              const SizedBox(height: 2),
              Text(desc,
                  style: GoogleFonts.poppins(
                      fontSize: 12,
                      color: const Color(0xFF64748B),
                      height: 1.4)),
            ],
          ),
        ),
      ],
    );
  }
}
