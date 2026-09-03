import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:math' show cos, pi, sqrt;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';
import 'package:jago_shared_core/jago_shared_core.dart';
import '../../services/heatmap_service.dart';
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import '../../services/vehicle_status_service.dart';
import '../../services/alarm_service.dart';
import '../../services/online_keepalive_service.dart';
import '../../widgets/incoming_offers_overlay.dart';
import '../../services/fcm_service.dart';
import '../auth/login_screen.dart';
import '../auth/pending_verification_screen.dart';
import '../wallet/wallet_screen.dart';
import '../history/trips_history_screen.dart';
import '../profile/profile_screen.dart';
import '../fatigue/fatigue_screen.dart';
import '../trip/trip_screen.dart';
import '../notifications/notifications_screen.dart';
import '../referral/referral_screen.dart';
import '../profile/support_chat_screen.dart';
import '../onboarding/model_selection_screen.dart';
import '../earnings/earnings_screen.dart';
import '../parcel/parcel_delivery_screen.dart';
import '../profile/activated_services_screen.dart';
import '../local_pool/local_pool_screen.dart';
import '../outstation_pool/outstation_pool_trip_screen.dart';
import '../outstation_pool/outstation_pool_availability_screen.dart';

/// The single source of truth for which ride requests a driver can receive.
/// Never stored directly — see `_HomeScreenState._driverMode`.
enum DriverServiceMode { cab, offline, carShare }

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin, WidgetsBindingObserver {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final SocketService _socket = SocketService();
  GoogleMapController? _mapController;
  LatLng _center = const LatLng(16.5062, 80.6480);
  double _selfHeading = 0;
  BitmapDescriptor? _selfIcon;
  bool _isOnline = false;
  bool _carShareEnabled = false;
  bool _modeSwitching = false;
  bool _socketConnected = false;
  String _userName = 'Pilot';
  String _userPhone = '';
  double _walletBalance = 0;
  int _tripsToday = 0;
  double _earningsToday = 0;
  double _driverRating = 5.0;
  int _unreadNotifCount = 0;
  Map<String, dynamic>? _incomingTrip;
  Map<String, dynamic>? _incomingParcel;
  Map<String, dynamic>? _incomingPoolOffer;
  String _vehicleCategory = '';
  // vehicle_categories.type ("motor_bike" / "auto" / "car") — a stable
  // machine classification, unlike _vehicleCategory (the human-editable
  // display name, e.g. "Mini Car"/"SUV / XL", which an admin can rename at
  // any time). Gates the Cab/Offline/Car Share selector vs a plain
  // Online/Offline toggle — see _isCabOrCarCategory.
  String _vehicleTypeCode = '';
  String _vehicleNumber = '';
  String _vehicleModel = '';
  bool _hasValidLocationFix = false;
  bool _hasLiveLocationAccess = false;
  Timer? _locationTimer;
  StreamSubscription<Position>? _posStream; // live GPS stream — battery-efficient
  Position? _lastPosition; // cached position for server updates
  // Car Share's own driver_pool_sessions.current_lat/lng was previously only
  // ever updated by LocalPoolScreen's own Timer, which dies the instant that
  // screen unmounts — e.g. the moment a driver returns to this Home Screen
  // after starting a session, which the new mode selector makes the natural
  // next action. The session's location then never moves again, so once the
  // driver's real position drifts outside the match radius (or if the first
  // sync never even completed), the rolling-pool matcher silently stops
  // finding them and no Car Share alert is ever delivered. This timer keeps
  // that location flowing for as long as Car Share mode is active, regardless
  // of which screen is on top — the same guarantee Cab mode already has via
  // `_locationTimer`/`_posStream` above.
  Timer? _carShareLocationTimer;
  late AnimationController _pulseCtrl;
  final List<StreamSubscription> _subs = [];
  int _navIndex = 0;
  double? _bottomPanelHeightFraction;
  final VehicleStatusService _vehicleStatusService = VehicleStatusService();
  Map<String, VehicleStatus> _vehicleStatuses = {
    for (final status in VehicleStatusService.fallbackStatuses) status.key: status,
  };
  StreamSubscription<Map<String, VehicleStatus>>? _vehicleStatusSub;
  bool _serviceUnavailableNoticeShown = false;

  // ── Heatmap ────────────────────────────────────────────────────────────
  final HeatmapService _heatmap = HeatmapService();
  Set<Circle> _heatmapCircles = {};
  bool _showHeatmap = true;
  HeatmapZone? _nearestHighZone;
  Timer? _idleTimer;
  int _idleSeconds = 0;
  bool _idleSuggestionShown = false;

  // ── Eligible Services ──────────────────────────────────────────────────
  bool _mapReadyToLoad = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 2))
      ..repeat(reverse: true);

    // DEFER ALL HEAVY UI/API TASKS UNTIL AFTER FIRST FRAME TO PREVENT ANRs
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await Future.delayed(const Duration(milliseconds: 300));
      if (!mounted) return;
      setState(() => _mapReadyToLoad = true);
      
      _checkVerificationStatus();
      _loadUser();
      _getLocation();
      _fetchDashboard();
      _fetchLaunchBenefit();
      _fetchEligibleServices();
      _fetchRevenueConfig();
      _watchVehicleAvailability();
      _connectSocket();
      
      await _recoverActiveTrip();
      await _consumeQueuedAlertAction();
      await _checkPendingFcmTrip();
    });
  }

  Future<void> _checkVerificationStatus() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/verification-status'),
        headers: headers,
      );
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (data['verificationStatus'] != 'approved') {
          if (!mounted) return;
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(builder: (_) => const PendingVerificationScreen()),
          );
        } else if (data['modelSelectedAt'] == null) {
          final inFreePeriod = data['launchFreeActive'] == true &&
              data['freePeriodEnd'] != null &&
              DateTime.tryParse(data['freePeriodEnd'].toString())?.isAfter(DateTime.now()) == true;
          if (!inFreePeriod) {
            if (!mounted) return;
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(builder: (_) => const ModelSelectionScreen()),
            );
          }
        }
      }
    } catch (_) {}
  }

  // ── App state recovery: if driver has an active trip, go to TripScreen directly ──
  Future<void> _recoverActiveTrip() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/active-trip'),
        headers: headers,
      );
      if (res.statusCode != 200) return;
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final trip = data['trip'];
      if (trip == null) return;
      final tripData = Map<String, dynamic>.from(trip as Map);
      final status = tripData['currentStatus'] ?? tripData['current_status'] ?? '';
      final serviceType = (tripData['type'] ??
              tripData['tripType'] ??
              tripData['serviceType'] ??
              tripData['service_type'] ??
              '')
          .toString()
          .toLowerCase();
      final isParcel = serviceType.contains('parcel') || serviceType.contains('cargo');
      final validStatuses = isParcel
          ? ['accepted', 'driver_assigned', 'arrived', 'in_transit']
          : ['accepted', 'arrived', 'on_the_way', 'in_progress', 'driver_assigned'];
      if (!validStatuses.contains(status)) return;
      if (!mounted) return;
      // Navigate directly to trip screen — driver was mid-trip when app crashed
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(
          builder: (_) => isParcel
              ? ParcelDeliveryScreen(order: tripData)
              : TripScreen(trip: tripData),
        ),
      );
      return;
    } catch (_) {}

    try {
      final headers = await AuthService.getHeaders();
      final poolSessionRes = await http.get(
        Uri.parse(ApiConfig.localPoolSessionActive),
        headers: headers,
      );
      if (poolSessionRes.statusCode == 200) {
        final payload = jsonDecode(poolSessionRes.body) as Map<String, dynamic>;
        final data = payload['data'] is Map<String, dynamic> ? payload['data'] as Map<String, dynamic> : payload;
        if (data['session'] != null && mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(builder: (_) => const LocalPoolScreen()),
          );
          return;
        }
      }
    } catch (_) {}

    try {
      final headers = await AuthService.getHeaders();
      final ridesRes = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/outstation-pool/rides'),
        headers: headers,
      );
      if (ridesRes.statusCode != 200) return;
      final payload = jsonDecode(ridesRes.body) as Map<String, dynamic>;
      final rawItems = payload['data'] is List
          ? payload['data'] as List
          : payload['rides'] is List
              ? payload['rides'] as List
              : const [];
      final items = rawItems
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList();
      final activeRide = items.cast<Map<String, dynamic>?>().firstWhere(
            (ride) {
              final state = ride?['status']?.toString() ?? '';
              return state == 'scheduled' || state == 'active';
            },
            orElse: () => null,
          );
      if (activeRide != null && mounted) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => OutstationPoolTripScreen(ride: activeRide),
          ),
        );
      }
    } catch (_) {}
  }

  Future<void> _checkPendingFcmTrip() async {
    try {
      final prefs = await SharedPreferences.getInstance();

      // ── Pending ride ──────────────────────────────────────────────────────
      final pendingTripStr = prefs.getString('pending_trip_data');
      if (pendingTripStr != null && pendingTripStr.isNotEmpty) {
        await prefs.remove('pending_trip_data');
        final tripData = jsonDecode(pendingTripStr) as Map<String, dynamic>;
        if (!_canReceiveTripPayload(tripData)) {
          _showUnavailableByAdminOnce();
          return;
        }
        if (mounted && _incomingTrip == null) {
          await Future.delayed(const Duration(milliseconds: 300));
          if (!mounted) return;
          setState(() => _incomingTrip = tripData);
        }
      }

      // ── Pending parcel ────────────────────────────────────────────────────
      final pendingParcelStr = prefs.getString('pending_parcel_data');
      if (pendingParcelStr != null && pendingParcelStr.isNotEmpty) {
        await prefs.remove('pending_parcel_data');
        final parcelData = jsonDecode(pendingParcelStr) as Map<String, dynamic>;
        if (mounted && _incomingParcel == null) {
          await Future.delayed(const Duration(milliseconds: 300));
          if (!mounted) return;
          setState(() => _incomingParcel = parcelData);
        }
      }

      final pendingPoolStr = prefs.getString('pending_pool_data');
      if (pendingPoolStr != null && pendingPoolStr.isNotEmpty) {
        await prefs.remove('pending_pool_data');
        final poolData = jsonDecode(pendingPoolStr) as Map<String, dynamic>;
        if (poolData['type'] == 'pool_new_passenger') {
          // Woken from background for a new Car Share match — show the same
          // incoming-offer alert a live socket event would, built directly
          // from the FCM data (rolling-pool.ts sends the same fields as the
          // socket payload) rather than just silently navigating away.
          if (mounted && _incomingPoolOffer == null) {
            setState(() => _incomingPoolOffer = poolData);
          }
        } else {
          await _recoverActiveTrip();
        }
      }
    } catch (_) {}
  }

  bool _canReceiveTripPayload(Map<String, dynamic> trip) {
    final tripVehicle = (trip['vehicleCategory'] ??
            trip['vehicleCategoryName'] ??
            trip['vehicle_type'] ??
            trip['vehicleType'] ??
            _vehicleCategory)
        .toString();
    return VehicleStatusService.isActive(_vehicleStatuses, tripVehicle);
  }

  void _showUnavailableByAdminOnce() {
    if (_serviceUnavailableNoticeShown) return;
    _serviceUnavailableNoticeShown = true;
    _showSnack('Your service is temporarily unavailable by admin', error: true);
    Future.delayed(const Duration(seconds: 4), () {
      _serviceUnavailableNoticeShown = false;
    });
  }

  Future<void> _connectSocket() async {
    await _socket.connect(ApiConfig.socketUrl);

    _subs.add(_socket.onConnectionChanged.listen((connected) {
      if (mounted) setState(() => _socketConnected = connected);
    }));

    _subs.add(_socket.onNewTrip.listen((trip) {
      if (!mounted) return;
      if (!_canReceiveTripPayload(trip)) {
        _showUnavailableByAdminOnce();
        return;
      }
      if (_incomingTrip == null) {
        setState(() => _incomingTrip = trip);
      }
    }));

    _subs.add(_socket.onTripCancelled.listen((data) {
      if (!mounted) return;
      FcmService().dismissTripNotification();
      setState(() => _incomingTrip = null);
      Navigator.of(context).popUntil((r) => r.isFirst);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Customer cancelled the trip', style: TextStyle(fontWeight: FontWeight.w500)),
        backgroundColor: JT.error,
        behavior: SnackBarBehavior.floating,
      ));
    }));

    _subs.add(_socket.onTripTaken.listen((data) {
      if (!mounted) return;
      if (_incomingTrip == null) return;
      final takenTripId = (data['tripId'] ?? data['id'] ?? '').toString();
      final currentTripId = (_incomingTrip?['tripId'] ?? _incomingTrip?['id'] ?? '').toString();
      if (currentTripId.isEmpty || takenTripId.isEmpty || takenTripId == currentTripId) {
        FcmService().dismissTripNotification();
        setState(() => _incomingTrip = null);
        Navigator.of(context).popUntil((r) => r.isFirst);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Another driver accepted this trip', style: TextStyle(fontWeight: FontWeight.w400)),
          backgroundColor: JT.textSecondary,
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: 2),
        ));
      }
    }));

    _subs.add(_socket.onTripTimeout.listen((data) {
      if (!mounted) return;
      if (_incomingTrip == null) return;
      final timeoutTripId = (data['tripId'] ?? data['id'] ?? '').toString();
      final currentTripId = (_incomingTrip?['tripId'] ?? _incomingTrip?['id'] ?? '').toString();
      if (currentTripId.isEmpty || timeoutTripId.isEmpty || timeoutTripId == currentTripId) {
        FcmService().dismissTripNotification();
        setState(() => _incomingTrip = null);
        Navigator.of(context).popUntil((r) => r.isFirst);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Trip request timed out', style: TextStyle(fontWeight: FontWeight.w400)),
          backgroundColor: JT.warning,
          behavior: SnackBarBehavior.floating,
          duration: Duration(seconds: 3),
        ));
      }
    }));

    _subs.add(_socket.onNoDrivers.listen((_) {
      AlarmService().stopAlarm();
    }));

    _subs.add(_socket.onNewParcel.listen((parcel) {
      if (!mounted) return;
      if (!_isOnline) return;
      if (_incomingParcel != null) return;
      setState(() => _incomingParcel = parcel);
    }));

    // Car Share: previously this stream was only consumed inside
    // LocalPoolScreen (a silent list refresh, no alert) — a driver anywhere
    // else in the app, or who hadn't opened that screen, never saw a new
    // passenger match at all. Subscribing here mirrors onNewTrip/onNewParcel
    // so it surfaces through the same IncomingOffersOverlay regardless of
    // which screen is showing.
    _subs.add(_socket.onPoolNewPassenger.listen((offer) {
      if (!mounted || !_carShareEnabled) return;
      if (_incomingPoolOffer != null) return;
      setState(() => _incomingPoolOffer = offer);
    }));

    _subs.add(_socket.onWalletRecharged.listen((data) {
      if (!mounted) return;
      final newBalance = (data['newBalance'] ?? data['balance'] ?? 0).toDouble();
      setState(() => _walletBalance = newBalance);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('Wallet recharged! Balance: ₹${newBalance.toStringAsFixed(0)}',
            style: const TextStyle(fontWeight: FontWeight.w500)),
        backgroundColor: JT.success,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 3),
      ));
    }));

    // ── FCM foreground stream: app is open, direct-show IncomingTripSheet ─
    // Fires when FCM arrives while app is in foreground (no notification shown).
    // Also fires after notification tap when app is in background/terminated.
    _subs.add(FcmService().onForegroundAlert.listen((data) {
      if (!mounted || !_isOnline) return;
      final type = data['type'] ?? '';
      if (type == 'new_trip' && _incomingTrip == null) {
        if (!_canReceiveTripPayload(data)) {
          _showUnavailableByAdminOnce();
          return;
        }
        setState(() => _incomingTrip = data);
      } else if (type == 'new_parcel' && _incomingParcel == null) {
        setState(() => _incomingParcel = data);
      }
    }));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final s in _subs) s.cancel();
    _vehicleStatusSub?.cancel();
    _locationTimer?.cancel();
    _posStream?.cancel();
    _carShareLocationTimer?.cancel();
    _idleTimer?.cancel();
    _heatmap.stopRefresh();
    _pulseCtrl.dispose();
    _socket.disconnect();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused && _isOnline) {
      return;
    }
    if (state == AppLifecycleState.resumed) {
      _consumeQueuedAlertAction();
      _checkPendingFcmTrip();
      // Previously this only ran once from initState (cold start) — a
      // background→foreground resume never re-checked, so an accepted
      // trip/pool session/outstation ride whose status changed while
      // backgrounded wouldn't be reflected until a full restart. Safe to
      // call repeatedly: it's a no-op unless it actually finds something
      // to resume into.
      _recoverActiveTrip();
    }
    if (state == AppLifecycleState.paused) {
      // App backgrounded — suspend GPS stream + server poll to save battery
      // Socket stays connected so the driver still receives trip requests via FCM
      _locationTimer?.cancel();
      _locationTimer = null;
      _posStream?.cancel();
      _posStream = null;
    } else if (state == AppLifecycleState.resumed) {
      // Came back to foreground — refresh GPS fix and resume live updates if needed
      _refreshLocationAfterResume();
    }
    // Belt-and-suspenders: _carShareLocationTimer isn't cancelled on pause
    // (it relies on the same foreground-service keep-alive as Cab mode to
    // keep ticking in the background), but on the rare chance the OS killed
    // it anyway, resuming restarts it — the internal null-check makes this
    // a no-op if it's already running.
    if (state == AppLifecycleState.resumed && _carShareEnabled) {
      _startCarShareLocationSync();
    }
  }

  Future<void> _refreshLocationAfterResume() async {
    await _getLocation();
    if (!mounted || !_isOnline || !_hasValidLocationFix || !_hasLiveLocationAccess) return;
    _startLocationStreaming();
    _socket.setOnlineStatus(
      isOnline: true,
      lat: _center.latitude,
      lng: _center.longitude,
    );
  }

  void _applyLocationFix(Position pos, {bool animate = true}) {
    _lastPosition = pos;
    _hasValidLocationFix = true;
    if (!mounted) return;
    setState(() {
      _center = LatLng(pos.latitude, pos.longitude);
      if (pos.heading.isFinite) _selfHeading = pos.heading;
    });
    _ensureSelfIcon();
    if (animate) {
      _mapController?.animateCamera(CameraUpdate.newLatLngZoom(_center, 15));
    }
  }

  Future<void> _showLocationRequiredDialog({
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

  Future<void> _loadUser() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _userName = prefs.getString('user_name') ?? 'Pilot';
      _userPhone = prefs.getString('user_phone') ?? '';
    });
  }

  bool get _isDriverVehicleActive {
    if (_vehicleCategory.trim().isEmpty) return true;
    return VehicleStatusService.isActive(_vehicleStatuses, _vehicleCategory);
  }

  void _watchVehicleAvailability() {
    _vehicleStatusSub?.cancel();
    _vehicleStatusSub = _vehicleStatusService.watchVehicleStatuses().listen((statuses) {
      if (!mounted) return;
      setState(() => _vehicleStatuses = statuses);
      if (_isOnline && !_isDriverVehicleActive) {
        _forceOfflineForInactiveService();
      }
    });
  }

  Future<void> _forceOfflineForInactiveService() async {
    if (!mounted) return;
    setState(() => _isOnline = false);
    _stopLocationStreaming();
    _stopHeatmap();
    _socket.setOnlineStatus(
      isOnline: false,
      lat: _center.latitude,
      lng: _center.longitude,
    );
    _showSnack('Your service is temporarily unavailable by admin', error: true);
    try {
      final headers = await AuthService.getHeaders();
      await http.patch(
        Uri.parse(ApiConfig.driverOnlineStatus),
        headers: headers,
        body: jsonEncode({
          'isOnline': false,
          'lat': _center.latitude,
          'lng': _center.longitude,
        }),
      ).timeout(const Duration(seconds: 4));
    } catch (_) {}
  }

  Future<void> _getLocation() async {
    try {
      // 1. Check if service is enabled
      bool serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        _hasLiveLocationAccess = false;
        if (mounted) {
          _showSnack('Please turn on GPS/Location in your settings.', error: true);
          await Geolocator.openLocationSettings();
        }
        return;
      }

      // 2. Check Permissions
      LocationPermission perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        _hasLiveLocationAccess = false;
        if (mounted) {
          await _showLocationRequiredDialog(
            title: 'Location Required',
            message: 'Location access is required to receive ride requests. Please set it to "Allow all the time" in settings.',
            openSettings: Geolocator.openAppSettings,
          );
        }
        return;
      }

      // 3. We have permission and service!
      _hasLiveLocationAccess = true;

      // 4. Get a position (Fallback to last known first for speed)
      final lastKnown = await Geolocator.getLastKnownPosition();
      if (lastKnown != null) {
        _applyLocationFix(lastKnown, animate: _lastPosition == null);
      }

      // 5. Get fresh accurate position
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 8),
        ),
      ).catchError((e) => lastKnown ?? Position(
        latitude: _center.latitude,
        longitude: _center.longitude,
        timestamp: DateTime.now(),
        accuracy: 0,
        altitude: 0,
        heading: 0,
        speed: 0,
        speedAccuracy: 0, altitudeAccuracy: 0, headingAccuracy: 0,
      ));

      _applyLocationFix(pos);
    } catch (e) {
      debugPrint('Location Error: $e');
      // If we have any last position, we allow going online even if fresh catch fails
      if (_lastPosition != null) {
        _hasValidLocationFix = true;
        _hasLiveLocationAccess = true;
      }
    }
  }

  void _handleSessionExpired() {
    AuthService.rehydrateStoredSession().then((stillValid) async {
      if (stillValid || !mounted) return;
      OnlineKeepAliveService.stop();
      await AuthService.clearLocalSession();
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Session expired. Please login again.', style: TextStyle(fontWeight: FontWeight.w500)),
        backgroundColor: JT.error,
        behavior: SnackBarBehavior.floating,
      ));
    });
  }

  Future<void> _consumeQueuedAlertAction() async {
    final queued = await FcmService().consumeQueuedAction();
    if (queued == null || !mounted) return;

    final actionId = (queued['actionId'] ?? '').toString();
    final rawData = queued['data'];
    if (rawData is! Map) return;
    final data = Map<String, dynamic>.from(rawData);

    final prefs = await SharedPreferences.getInstance();
    if (actionId.startsWith('trip_')) {
      await prefs.remove('pending_trip_data');
    }
    if (actionId == 'parcel_open') {
      await prefs.remove('pending_parcel_data');
    }

    if (actionId == 'trip_accept') {
      await _acceptIncomingTrip(data);
      return;
    }

    if (actionId == 'trip_reject') {
      await _rejectIncomingTrip(data);
      return;
    }

    if (actionId == 'parcel_open' && _incomingParcel == null) {
      setState(() => _incomingParcel = data);
    }
  }

  Future<void> _fetchDashboard() async {
    final token = await AuthService.getToken();
    if (token == null || token.isEmpty) {
      _handleSessionExpired();
      return;
    }
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.driverDashboard), headers: headers);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (!mounted) return;
        setState(() {
          _isOnline = data['isOnline'] ?? false;
          _carShareEnabled = data['carShareEnabled'] ?? false;
          _walletBalance = (data['walletBalance'] ?? 0).toDouble();
          _tripsToday = data['tripsToday'] ?? 0;
          _earningsToday = (data['earningsToday'] ?? 0).toDouble();
          _vehicleCategory = data['vehicleCategory'] ?? '';
          _vehicleTypeCode = (data['vehicleType'] ?? '').toString();
          _vehicleNumber = data['vehicleNumber'] ?? '';
          _vehicleModel = data['vehicleModel'] ?? '';
          _driverRating = double.tryParse(data['rating']?.toString() ?? '') ?? _driverRating;
        });
        if (_isOnline) {
          OnlineKeepAliveService.start();
          if (!_hasValidLocationFix) {
            await _getLocation();
          }
          if (_hasValidLocationFix && _hasLiveLocationAccess) {
            _startLocationStreaming();
          }
          // Re-announce online status via socket — restores driver_locations.is_online=true
          // after app restart/crash where socket disconnect handler had set it false.
          // Without this, dispatch won't find driver until first GPS update arrives (3s delay).
          if (_hasValidLocationFix && _hasLiveLocationAccess) {
            _socket.setOnlineStatus(
              isOnline: true,
              lat: _center.latitude,
              lng: _center.longitude,
            );
          }
        }
      } else if (res.statusCode == 401) {
        _handleSessionExpired();
        return;
      }
    } catch (_) {}
  }

  Future<void> _fetchLaunchBenefit() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.launchBenefit), headers: headers);
      if (res.statusCode == 200) {
        if (mounted) {
          setState(() {});
        }
      }
    } catch (_) {}
  }

  Future<void> _fetchEligibleServices() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.eligibleServices), headers: headers);
      if (res.statusCode == 200 && mounted) {
        setState(() {});
      }
    } catch (_) {}
  }

  Future<void> _fetchRevenueConfig() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.revenueConfig), headers: headers);
      if (res.statusCode == 200 && mounted) {
        setState(() {});
      }
    } catch (_) {}
  }

  Future<void> _fetchUnreadCount() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.notifications), headers: headers);
      if (res.statusCode == 200 && mounted) {
        final data = jsonDecode(res.body);
        setState(() => _unreadNotifCount = (data['unreadCount'] ?? 0).toInt());
      }
    } catch (_) {}
  }

  bool _loadingSelfIcon = false;
  int _selfIconAttempts = 0;
  // A failed/timed-out photo fetch (slow network) still returns a non-null
  // hand-drawn fallback icon from JagoMapMarkers, so "_selfIcon != null" alone
  // can't tell success from fallback. Keep retrying on every GPS-driven call
  // for a bounded number of attempts — cheap once the real photo is cached
  // (JagoMapMarkers.vehicle then resolves instantly, no network hit) and lets
  // the marker self-heal into the real vehicle photo once the network allows.
  static const int _maxSelfIconAttempts = 6;
  Future<void> _ensureSelfIcon() async {
    if (_loadingSelfIcon) return;
    if (_selfIcon != null && _selfIconAttempts >= _maxSelfIconAttempts) return;
    _loadingSelfIcon = true;
    _selfIconAttempts++;
    final icon = await JagoMapMarkers.vehicle(_vehicleCategory);
    _loadingSelfIcon = false;
    if (!mounted) return;
    setState(() => _selfIcon = icon);
  }

  void _startLocationStreaming() {
    if (!_hasValidLocationFix || !_hasLiveLocationAccess) return;
    _locationTimer?.cancel();
    _posStream?.cancel();

    // ── GPS stream: hardware-managed, emits only when device moves ≥ 15 m ──
    // Far more battery-efficient than calling getCurrentPosition every 3 s.
    // iOS needs its own LocationSettings subclass - AndroidSettings' extras
    // (foreground-service notification, wakelock) are Android-only and are
    // silently ignored on iOS, which otherwise falls back to a default that
    // does NOT keep streaming once the app is backgrounded, despite
    // UIBackgroundModes:location being declared in Info.plist.
    final LocationSettings locationSettings = Platform.isIOS
        ? AppleSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 10,
            activityType: ActivityType.automotiveNavigation,
            pauseLocationUpdatesAutomatically: false,
            allowBackgroundLocationUpdates: true,
            showBackgroundLocationIndicator: true,
          )
        : AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 10,
            intervalDuration: Duration(seconds: 3),
            foregroundNotificationConfig: ForegroundNotificationConfig(
              notificationText: 'JAGO Pro Pilot is tracking your location',
              notificationTitle: 'Location Tracking Active',
              enableWakeLock: true,
              setOngoing: true,
            ),
          );
    _posStream = Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).listen((pos) {
      _lastPosition = pos;
      if (mounted) {
        setState(() {
          _center = LatLng(pos.latitude, pos.longitude);
          if (pos.heading.isFinite) _selfHeading = pos.heading;
        });
        _ensureSelfIcon();
      }
    }, onError: (_) {});

    // ── Server-update timer: every 5 s (was 3 s) — sends cached position ──
    _locationTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      final pos = _lastPosition;
      if (pos == null || !mounted) return;

      final lat = pos.latitude;
      final lng = pos.longitude;
      final reqHeaders = await AuthService.getHeaders();

      _socket.sendLocation(lat: lat, lng: lng, speed: pos.speed);
      // Fire-and-forget — don't await; avoids blocking the timer tick
      http.post(
        Uri.parse(ApiConfig.driverLocation),
        headers: reqHeaders,
        body: jsonEncode({'lat': lat, 'lng': lng, 'isOnline': true}),
      ).catchError((_) => http.Response('', 500));

      if (_isOnline && _incomingTrip == null) {
        try {
          final resp = await http.get(
            Uri.parse(ApiConfig.driverIncomingTrip),
            headers: reqHeaders,
          ).timeout(const Duration(seconds: 4));
          if (resp.statusCode == 200 && mounted) {
            final data = jsonDecode(resp.body) as Map<String, dynamic>;
            final trip = data['trip'];
            final stage = (data['stage'] ?? '').toString();
            if (trip != null && stage == 'new_request' && _incomingTrip == null) {
              final tripMap = Map<String, dynamic>.from(trip as Map);
              tripMap['tripId'] = tripMap['tripId'] ?? tripMap['id'];
              if (!_canReceiveTripPayload(tripMap)) {
                _showUnavailableByAdminOnce();
                return;
              }
              setState(() => _incomingTrip = tripMap);
            }
          }
        } catch (_) {}
      }
    });
  }

  void _stopLocationStreaming() {
    _locationTimer?.cancel();
    _locationTimer = null;
    _posStream?.cancel();
    _posStream = null;
    _lastPosition = null;
  }

  /// Keeps `driver_pool_sessions.current_lat/lng` fresh for as long as Car
  /// Share mode is active — independent of whether LocalPoolScreen happens
  /// to be the visible route. See the `_carShareLocationTimer` field comment
  /// for why this exists. Posts to the same endpoint LocalPoolScreen's own
  /// (screen-lifetime-only) sync already uses, so this is purely additive —
  /// nothing on the backend needed to change.
  void _startCarShareLocationSync() {
    if (_carShareLocationTimer != null) return;
    debugPrint('[CAR_SHARE_LOCATION_SYNC] starting home-level location sync');
    _syncCarShareLocation();
    _carShareLocationTimer = Timer.periodic(const Duration(seconds: 8), (_) => _syncCarShareLocation());
  }

  void _stopCarShareLocationSync() {
    if (_carShareLocationTimer == null) return;
    debugPrint('[CAR_SHARE_LOCATION_SYNC] stopping home-level location sync');
    _carShareLocationTimer?.cancel();
    _carShareLocationTimer = null;
  }

  Future<void> _syncCarShareLocation() async {
    if (!_carShareEnabled) {
      _stopCarShareLocationSync();
      return;
    }
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(const Duration(seconds: 6));
      final headers = await AuthService.getHeaders();
      final res = await http.patch(
        Uri.parse(ApiConfig.localPoolLocation),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'lat': pos.latitude,
          'lng': pos.longitude,
          'bearingDeg': pos.heading.isFinite ? pos.heading : null,
        }),
      ).timeout(const Duration(seconds: 6));
      debugPrint('[CAR_SHARE_LOCATION_SYNC] posted lat=${pos.latitude} lng=${pos.longitude} status=${res.statusCode}');
    } catch (e) {
      // Keep this silent for the driver (matches LocalPoolScreen's own
      // sync) but log it — a permission/GPS failure here is exactly the
      // kind of thing that otherwise silently explains "no alerts ever".
      debugPrint('[CAR_SHARE_LOCATION_SYNC] sync failed: $e');
    }
  }

  // ── Heatmap methods ────────────────────────────────────────────────────

  void _startHeatmapRefresh() {
    _idleSuggestionShown = false;
    _heatmap.startRefresh(
      _center.latitude, _center.longitude,
      onUpdate: () {
        if (!mounted) return;
        setState(() {
          _heatmapCircles = _showHeatmap ? _heatmap.buildCircles() : {};
          _nearestHighZone = _heatmap.nearestHighDemand(
            _center.latitude, _center.longitude);
        });
      },
    );
  }

  void _stopHeatmap() {
    _idleTimer?.cancel();
    _idleTimer = null;
    _idleSeconds = 0;
    _idleSuggestionShown = false;
    _heatmap.stopRefresh();
    if (mounted) setState(() { _heatmapCircles = {}; _nearestHighZone = null; });
  }

  void _toggleHeatmap() {
    setState(() {
      _showHeatmap = !_showHeatmap;
      _heatmapCircles = _showHeatmap ? _heatmap.buildCircles() : {};
    });
  }

  void _startIdleTimer() {
    _idleTimer?.cancel();
    _idleSeconds = 0;
    _idleSuggestionShown = false;
    final timeoutSecs = _heatmap.idleTimeoutMinutes * 60;
    _idleTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!_isOnline || _incomingTrip != null || _incomingParcel != null || !mounted) {
        _idleSeconds = 0;
        _idleSuggestionShown = false;
        return;
      }
      _idleSeconds++;
      if (_idleSeconds >= timeoutSecs && !_idleSuggestionShown) {
        _idleSuggestionShown = true;
        _triggerIdleSuggestion();
      }
    });
  }

  Future<void> _triggerIdleSuggestion() async {
    final sugg = await _heatmap.fetchSuggestion(_center.latitude, _center.longitude);
    if (sugg == null || !mounted) return;
    _showIdleSuggestionDialog(sugg);
  }

  void _showIdleSuggestionDialog(HeatmapSuggestion sugg) {
    showDialog(
      context: context,
      barrierColor: Colors.black38,
      builder: (_) => AlertDialog(
        backgroundColor: JT.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: JT.border, width: 1),
        ),
        title: Row(children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: sugg.demandLevel == 'high'
                  ? JT.error.withValues(alpha: 0.10)
                  : JT.warning.withValues(alpha: 0.10),
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.local_fire_department_rounded,
              color: sugg.demandLevel == 'high' ? JT.error : JT.warning,
              size: 22),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text('Demand Zone Nearby',
              style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 16, fontWeight: FontWeight.w500)),
          ),
        ]),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(sugg.message, style: GoogleFonts.poppins(color: JT.textPrimary, fontSize: 14, fontWeight: FontWeight.w400)),
          const SizedBox(height: 8),
          Text(sugg.detail, style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 12)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: JT.success.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: JT.success.withValues(alpha: 0.25)),
            ),
            child: Row(children: [
              const Icon(Icons.currency_rupee_rounded, color: JT.success, size: 18),
              const SizedBox(width: 6),
              Text('₹${sugg.earningMin}–₹${sugg.earningMax} in 30 min',
                style: GoogleFonts.poppins(color: JT.success, fontWeight: FontWeight.w500, fontSize: 14)),
            ]),
          ),
        ]),
        actions: [
          TextButton(
            onPressed: () { Navigator.pop(context); _idleSuggestionShown = false; },
            child: Text('Stay Here', style: GoogleFonts.poppins(color: JT.textSecondary)),
          ),
          ElevatedButton.icon(
            onPressed: () {
              Navigator.pop(context);
              _mapController?.animateCamera(CameraUpdate.newLatLngZoom(
                LatLng(sugg.lat, sugg.lng), 14));
            },
            icon: const Icon(Icons.navigation_rounded, size: 16),
            label: const Text('Go There'),
            style: ElevatedButton.styleFrom(
              backgroundColor: JT.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _acceptIncomingTrip(Map<String, dynamic> trip) async {
    if (!_canReceiveTripPayload(trip)) {
      if (mounted) setState(() => _incomingTrip = null);
      await FcmService().dismissTripNotification();
      _showUnavailableByAdminOnce();
      return;
    }
    if (mounted) {
      setState(() => _incomingTrip = null);
    }
    await FcmService().dismissTripNotification();

    final tripId = (trip['tripId'] ?? trip['id'] ?? '').toString();
    if (tripId.isEmpty) {
      if (mounted) {
        _showSnack('Trip data is missing. Please wait for the next request.', error: true);
      }
      return;
    }

    bool accepted = false;
    if (_socketConnected) {
      accepted = await _socket.acceptTrip(tripId);
    }
    if (!accepted) {
      try {
        final hdrs = await AuthService.getHeaders();
        final res = await http.post(
          Uri.parse(ApiConfig.driverAcceptTrip),
          headers: {...hdrs, 'Content-Type': 'application/json'},
          body: jsonEncode({'tripId': tripId}),
        );
        if (res.statusCode == 200) accepted = true;
      } catch (_) {}
    }
    if (!mounted) return;
    if (accepted) {
      _socket.setActiveTrip(tripId);
    }

    Future<Map<String, dynamic>?> fetchAcceptedTrip() async {
      try {
        final hdrs = await AuthService.getHeaders();
        final res = await http.get(
          Uri.parse(ApiConfig.driverActiveTrip),
          headers: hdrs,
        ).timeout(const Duration(seconds: 30));
        if (res.statusCode != 200) return null;
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final activeTrip = data['trip'];
        if (activeTrip is! Map) return null;
        final serverTrip = Map<String, dynamic>.from(activeTrip);
        final serverTripId =
            (serverTrip['id'] ?? serverTrip['tripId'] ?? '').toString();
        if (serverTripId != tripId) return null;
        return Map<String, dynamic>.from(trip)..addAll(serverTrip);
      } catch (_) {
        return null;
      }
    }

    Map<String, dynamic>? fullTrip = await fetchAcceptedTrip();
    if (fullTrip == null) {
      for (final delayMs in const [350, 900, 1600]) {
        await Future.delayed(Duration(milliseconds: delayMs));
        if (!mounted) return;
        fullTrip = await fetchAcceptedTrip();
        if (fullTrip != null) {
          accepted = true;
          break;
        }
      }
    }
    if (!mounted) return;
    if (fullTrip == null && accepted) {
      // Fallback: use what we have from the socket/notification payload
      fullTrip = Map<String, dynamic>.from(trip);
    }
    
    if (fullTrip == null) {
      _showSnack(
        'Could not accept this trip. Please try the next request.',
        error: true,
      );
      return;
    }
    Navigator.push(context, MaterialPageRoute(builder: (_) => TripScreen(trip: fullTrip!)));
  }

  Future<void> _rejectIncomingTrip(Map<String, dynamic> trip) async {
    if (mounted) {
      setState(() => _incomingTrip = null);
    }
    await FcmService().dismissTripNotification();
    try {
      final hdrs = await AuthService.getHeaders();
      await http.post(
        Uri.parse(ApiConfig.driverRejectTrip),
        headers: {...hdrs, 'Content-Type': 'application/json'},
        body: jsonEncode({'tripId': trip['tripId'] ?? trip['id'] ?? ''}),
      );
    } catch (_) {}
  }

  Future<void> _acceptIncomingParcel(Map<String, dynamic> parcel) async {
    setState(() => _incomingParcel = null);
    final orderId = parcel['orderId']?.toString() ?? parcel['id']?.toString() ?? '';
    if (orderId.isEmpty) return;
    try {
      final hdrs = await AuthService.getHeaders();
      final r = await http.post(Uri.parse(ApiConfig.driverParcelAccept(orderId)), headers: hdrs);
      if (!mounted) return;
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body);
        final order = data['order'] as Map<String, dynamic>? ?? {};
        Navigator.push(context, MaterialPageRoute(builder: (_) => ParcelDeliveryScreen(order: order)));
      } else {
        _showSnack('Already taken by another driver', error: true);
      }
    } catch (_) {
      if (mounted) _showSnack('Network error, try again', error: true);
    }
  }

  void _declineIncomingParcel() {
    if (mounted) setState(() => _incomingParcel = null);
  }

  Future<void> _acceptIncomingPoolOffer(Map<String, dynamic> offer) async {
    setState(() => _incomingPoolOffer = null);
    final requestId = offer['requestId']?.toString() ?? offer['id']?.toString() ?? '';
    if (requestId.isEmpty) return;
    try {
      final hdrs = await AuthService.getHeaders();
      final r = await http.post(
        Uri.parse(ApiConfig.localPoolAcceptPassenger(requestId)),
        headers: {...hdrs, 'Content-Type': 'application/json'},
        body: jsonEncode(const {}),
      );
      if (!mounted) return;
      if (r.statusCode == 200) {
        Navigator.push(context, MaterialPageRoute(builder: (_) => const LocalPoolScreen()));
      } else {
        _showSnack('Already taken or no longer available', error: true);
      }
    } catch (_) {
      if (mounted) _showSnack('Network error, try again', error: true);
    }
  }

  Future<void> _declineIncomingPoolOffer() async {
    final offer = _incomingPoolOffer;
    if (mounted) setState(() => _incomingPoolOffer = null);
    final requestId = offer?['requestId']?.toString() ?? offer?['id']?.toString() ?? '';
    if (requestId.isEmpty) return;
    try {
      final hdrs = await AuthService.getHeaders();
      await http.post(
        Uri.parse(ApiConfig.localPoolSkipPassenger(requestId)),
        headers: {...hdrs, 'Content-Type': 'application/json'},
        body: jsonEncode(const {}),
      );
    } catch (_) {}
  }

  void _showSnack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: GoogleFonts.poppins(fontWeight: FontWeight.w500, color: Colors.white)),
      backgroundColor: error ? JT.error : JT.success,
      behavior: SnackBarBehavior.floating,
      margin: const EdgeInsets.all(16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      duration: const Duration(seconds: 4),
    ));
  }


  /// The three-way Cab / Offline / Car Share selector is derived, never
  /// stored — `_isOnline` IS cabAvailability and `_carShareEnabled` IS
  /// carShareAvailability. Deriving the mode from those two flags (instead
  /// of keeping a third `driverMode` field) makes the mutual-exclusion rule
  /// structural: there is no third variable that could ever drift out of
  /// sync with the two that actually gate dispatch.
  DriverServiceMode get _driverMode {
    if (_isOnline) return DriverServiceMode.cab;
    if (_carShareEnabled) return DriverServiceMode.carShare;
    return DriverServiceMode.offline;
  }

  /// Car Share only exists for 4-wheeler Cab/Car categories (Mini Car,
  /// Sedan, SUV/XL all register as vehicle_categories.type = 'car';
  /// Bike -> 'motor_bike', Auto -> 'auto'). Bike/Auto drivers get a plain
  /// Online/Offline toggle instead of the three-way selector.
  bool get _isCabOrCarCategory => _vehicleTypeCode.toLowerCase() == 'car';

  List<Color> _modeColors(DriverServiceMode mode) {
    switch (mode) {
      case DriverServiceMode.cab:
        return const [Color(0xFF2D8CFF), Color(0xFF1A6FDB)];
      case DriverServiceMode.offline:
        return const [Color(0xFF64748B), Color(0xFF475569)];
      case DriverServiceMode.carShare:
        return const [Color(0xFF10B981), Color(0xFF059669)];
    }
  }

  /// Switches between Cab / Offline / Car Share. The two backend flags are
  /// updated sequentially — whichever service is currently active is turned
  /// off (and confirmed by the server) before the target service is turned
  /// on — so the backend can never briefly represent both Cab and Car Share
  /// as active at once. If the "turn on" half fails after the "turn off"
  /// half already succeeded, we do not pretend to revert to the old mode
  /// (the backend no longer agrees with that); instead we land the driver
  /// safely Offline and say so, since that's the only state guaranteed to
  /// match what the server actually has.
  Future<void> _switchDriverMode(DriverServiceMode target) async {
    if (_modeSwitching || target == _driverMode) return;
    HapticFeedback.mediumImpact();

    // Car Share is a Cab/Car-only feature — the selector never renders this
    // option for Bike/Auto (see _isCabOrCarCategory / _buildModeSelector),
    // but refuse it here too so it can never be reached through any other
    // call path.
    if (target == DriverServiceMode.carShare && !_isCabOrCarCategory) {
      return;
    }

    if (target == DriverServiceMode.cab && !_isDriverVehicleActive) {
      _showSnack('Your service is temporarily unavailable by admin', error: true);
      return;
    }

    if (_carShareEnabled && target != DriverServiceMode.carShare) {
      final confirmed = await _confirmLeaveActiveCarShareSession();
      if (!confirmed) return;
    }

    final prevOnline = _isOnline;
    final prevCarShare = _carShareEnabled;
    setState(() => _modeSwitching = true);

    bool turnedOffPrevious = false;
    try {
      final headers = await AuthService.getHeaders();
      final jsonHeaders = {...headers, 'Content-Type': 'application/json'};

      // 1. Turn off whichever service is currently active but isn't the target.
      if (prevCarShare && target != DriverServiceMode.carShare) {
        await http.post(Uri.parse(ApiConfig.localPoolSessionEnd), headers: headers)
            .timeout(const Duration(seconds: 10));
        final res = await http.patch(
          Uri.parse(ApiConfig.updateProfile),
          headers: jsonHeaders,
          body: jsonEncode({'carShareEnabled': false}),
        ).timeout(const Duration(seconds: 8));
        if (res.statusCode != 200) throw Exception('Could not turn off Car Share');
        turnedOffPrevious = true;
        _stopCarShareLocationSync();
        OnlineKeepAliveService.stop();
      }
      if (prevOnline && target != DriverServiceMode.cab) {
        final res = await http.patch(
          Uri.parse(ApiConfig.driverOnlineStatus),
          headers: jsonHeaders,
          body: jsonEncode({'isOnline': false, 'lat': _center.latitude, 'lng': _center.longitude}),
        ).timeout(const Duration(seconds: 8));
        if (res.statusCode != 200) throw Exception('Could not turn off Cab Service');
        turnedOffPrevious = true;
        _stopLocationStreaming();
        _stopHeatmap();
        OnlineKeepAliveService.stop();
        _socket.setOnlineStatus(isOnline: false, lat: _center.latitude, lng: _center.longitude);
      }

      // 2. Turn on the target service.
      if (target == DriverServiceMode.cab) {
        if (!_hasValidLocationFix) await _getLocation();
        final res = await http.patch(
          Uri.parse(ApiConfig.driverOnlineStatus),
          headers: jsonHeaders,
          body: jsonEncode({'isOnline': true, 'lat': _center.latitude, 'lng': _center.longitude}),
        ).timeout(const Duration(seconds: 8));
        if (res.statusCode == 401) { _handleSessionExpired(); return; }
        if (res.statusCode != 200) throw Exception('Could not activate Cab Service');
      } else if (target == DriverServiceMode.carShare) {
        // Car Share matching hard-requires a non-null driver_pool_sessions
        // location (see rolling-pool.ts findBestSession) — a driver who
        // never activated Cab mode this session may never have been
        // prompted for location permission/a GPS fix at all, so request one
        // here too rather than assuming it already exists.
        if (!_hasValidLocationFix) await _getLocation();
        final res = await http.patch(
          Uri.parse(ApiConfig.updateProfile),
          headers: jsonHeaders,
          body: jsonEncode({'carShareEnabled': true}),
        ).timeout(const Duration(seconds: 8));
        if (res.statusCode == 401) { _handleSessionExpired(); return; }
        if (res.statusCode != 200) throw Exception('Could not activate Car Share');
        // From here on the backend already has carShareEnabled=true — any
        // failure below must land Offline (and roll this flag back) rather
        // than silently reverting the local UI while the backend disagrees.
        turnedOffPrevious = true;

        // Setting the eligibility flag alone does not make this driver
        // matchable — findBestSession() in rolling-pool.ts only ever looks
        // at driver_pool_sessions rows with status='active'. Previously this
        // selector stopped here and just navigated into LocalPoolScreen,
        // trusting the driver to notice they still had to pick a seat count
        // and press "Start Local Pool" there. In practice nobody did (it
        // isn't obvious a second step is required), so the driver showed as
        // "Car Share Active" on Home while having zero active session and
        // never matching anything. Starting the session here makes Car Share
        // genuinely one-tap, the same as Cab and Offline. 4 is a safe
        // default — the backend caps it to the driver's real vehicle
        // capacity regardless (driver_pool_sessions.start, seatsN clamp).
        final sessionRes = await http.post(
          Uri.parse(ApiConfig.localPoolSessionStart),
          headers: jsonHeaders,
          body: jsonEncode({'maxSeats': 4}),
        ).timeout(const Duration(seconds: 10));
        if (sessionRes.statusCode != 200) {
          String msg = 'Could not start Car Share session';
          try {
            final decoded = jsonDecode(sessionRes.body);
            msg = decoded['message']?.toString() ?? msg;
          } catch (_) {}
          // Best-effort rollback so the backend doesn't end up with
          // carShareEnabled=true while the driver shows as Offline.
          await http.patch(
            Uri.parse(ApiConfig.updateProfile),
            headers: jsonHeaders,
            body: jsonEncode({'carShareEnabled': false}),
          ).timeout(const Duration(seconds: 8)).catchError((_) => http.Response('', 500));
          throw Exception(msg);
        }
      }

      if (!mounted) return;
      setState(() {
        _isOnline = target == DriverServiceMode.cab;
        _carShareEnabled = target == DriverServiceMode.carShare;
        _modeSwitching = false;
      });

      if (target == DriverServiceMode.cab) {
        _startLocationStreaming();
        _startHeatmapRefresh();
        _startIdleTimer();
        OnlineKeepAliveService.start();
        _socket.setOnlineStatus(isOnline: true, lat: _center.latitude, lng: _center.longitude);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) OnlineKeepAliveService.maybePromptForBatteryExemption(context);
        });
      } else if (target == DriverServiceMode.carShare) {
        _startCarShareLocationSync();
        OnlineKeepAliveService.start();
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) OnlineKeepAliveService.maybePromptForBatteryExemption(context);
        });
      }

      _showSnack(switch (target) {
        DriverServiceMode.cab => _isCabOrCarCategory
            ? 'Cab Service activated — you can now receive ride requests'
            : 'You are online — you can now receive ride requests',
        DriverServiceMode.offline => 'You are offline',
        DriverServiceMode.carShare => 'Car Share activated — you can now receive passenger requests',
      });

      if (target == DriverServiceMode.carShare) {
        await Navigator.push(context, MaterialPageRoute(builder: (_) => const LocalPoolScreen()));
        _refreshCarShareState();
      }
    } catch (e) {
      if (!mounted) return;
      if (turnedOffPrevious) {
        // The previous service is already confirmed off on the backend —
        // claiming a revert here would lie about server state. Land Offline.
        _stopCarShareLocationSync();
        setState(() {
          _isOnline = false;
          _carShareEnabled = false;
          _modeSwitching = false;
        });
        final detail = e.toString().replaceFirst('Exception: ', '');
        _showSnack(
          detail.isNotEmpty && detail != 'null'
              ? '$detail — you are now offline. Please try again.'
              : 'Switched off, but could not activate the new mode. You are now offline — please try again.',
          error: true,
        );
      } else {
        setState(() {
          _isOnline = prevOnline;
          _carShareEnabled = prevCarShare;
          _modeSwitching = false;
        });
        _showSnack('Could not switch mode. Please check your connection and try again.', error: true);
      }
    }
  }

  /// Ending an active Car Share session mid-ride cancels any in-progress
  /// passenger pickups, so confirm before switching away from Car Share
  /// while a session is actually running.
  Future<bool> _confirmLeaveActiveCarShareSession() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.localPoolSessionActive), headers: headers)
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) return true;
      final body = jsonDecode(res.body);
      final data = (body is Map && body['data'] is Map) ? body['data'] as Map : body as Map;
      if (data['session'] == null) return true;
    } catch (_) {
      return true;
    }
    if (!mounted) return false;
    final result = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (_) => AlertDialog(
        backgroundColor: JT.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text('End Car Share session?', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 17)),
        content: Text(
          'You have an active Car Share session running. Switching modes now will end that session and cancel any in-progress passenger pickups.',
          style: GoogleFonts.poppins(fontSize: 13.5, color: JT.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text('Cancel', style: GoogleFonts.poppins(color: JT.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: JT.error,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('End Session'),
          ),
        ],
      ),
    );
    return result == true;
  }

  /// Re-syncs the "Available for Car Share?" flag after the driver returns
  /// from LocalPoolScreen, where the same flag can also be flipped directly
  /// — keeps this selector and that screen reading one shared piece of state.
  Future<void> _refreshCarShareState() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.driverProfile), headers: headers)
          .timeout(const Duration(seconds: 8));
      if (res.statusCode == 200 && mounted) {
        final body = jsonDecode(res.body);
        final user = (body is Map && body['user'] is Map) ? body['user'] as Map : body as Map;
        setState(() => _carShareEnabled = user['carShareEnabled'] == true);
      }
    } catch (_) {}
  }

  /// The on-screen control for `_driverMode`. Cab/Car category drivers get
  /// the full three-way Cab Service / Offline / Car Share selector; every
  /// other category (Bike, Auto, ...) gets the same widget rendering only
  /// two segments (plain Online / Offline) — one reusable component driven
  /// by which segments are available, rather than two separate widgets.
  /// A sliding gradient pill highlights whichever segment is active; tapping
  /// another calls `_switchDriverMode`.
  Widget _buildModeSelector() {
    final mode = _driverMode;
    final segments = _isCabOrCarCategory
        ? const [DriverServiceMode.cab, DriverServiceMode.offline, DriverServiceMode.carShare]
        : const [DriverServiceMode.cab, DriverServiceMode.offline];
    final index = segments.indexOf(mode).clamp(0, segments.length - 1);
    final widthFactor = 1 / segments.length;
    final alignment = segments.length == 1
        ? Alignment.center
        : Alignment(-1 + (2 * index / (segments.length - 1)), 0);
    return Container(
      height: 86,
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F7FF),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: const Color(0xFFE5E9F0)),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 18, offset: const Offset(0, 8)),
        ],
      ),
      child: Stack(
        children: [
          AnimatedAlign(
            duration: const Duration(milliseconds: 320),
            curve: Curves.easeOutCubic,
            alignment: alignment,
            child: FractionallySizedBox(
              widthFactor: widthFactor,
              heightFactor: 1,
              child: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: _modeColors(mode),
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: [
                    BoxShadow(color: _modeColors(mode).first.withValues(alpha: 0.35), blurRadius: 14, offset: const Offset(0, 6)),
                  ],
                ),
              ),
            ),
          ),
          Row(
            children: segments
                .map((segMode) => Expanded(
                      child: _modeSegment(segMode, _segmentIcon(segMode), _segmentLabel(segMode)),
                    ))
                .toList(),
          ),
          if (_modeSwitching)
            Positioned.fill(
              child: Center(
                child: Container(
                  width: 28,
                  height: 28,
                  padding: const EdgeInsets.all(5),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.18), blurRadius: 8)],
                  ),
                  child: CircularProgressIndicator(strokeWidth: 2.4, color: _modeColors(mode).first),
                ),
              ),
            ),
        ],
      ),
    );
  }

  IconData _segmentIcon(DriverServiceMode segMode) {
    switch (segMode) {
      case DriverServiceMode.cab:
        return _isCabOrCarCategory ? Icons.local_taxi_rounded : Icons.online_prediction_rounded;
      case DriverServiceMode.offline:
        return Icons.power_settings_new_rounded;
      case DriverServiceMode.carShare:
        return Icons.directions_car_filled_rounded;
    }
  }

  String _segmentLabel(DriverServiceMode segMode) {
    switch (segMode) {
      case DriverServiceMode.cab:
        return _isCabOrCarCategory ? 'CAB SERVICE' : 'ONLINE';
      case DriverServiceMode.offline:
        return 'OFFLINE';
      case DriverServiceMode.carShare:
        return 'CAR SHARE';
    }
  }

  Widget _modeSegment(DriverServiceMode segMode, IconData icon, String label) {
    final selected = _driverMode == segMode;
    final isOffline = segMode == DriverServiceMode.offline;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: _modeSwitching ? null : () => _switchDriverMode(segMode),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedScale(
            duration: const Duration(milliseconds: 250),
            scale: selected ? 1.08 : 1.0,
            child: Icon(
              icon,
              size: isOffline ? (selected ? 27 : 24) : (selected ? 23 : 20),
              color: selected ? Colors.white : const Color(0xFF94A3B8),
            ),
          ),
          const SizedBox(height: 5),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 250),
                style: GoogleFonts.poppins(
                  color: selected ? Colors.white : const Color(0xFF64748B),
                  fontSize: 11.5,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                  letterSpacing: 0.3,
                ),
                child: Text(label, textAlign: TextAlign.center, maxLines: 1),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasIncomingOffer = _incomingTrip != null || _incomingParcel != null || _incomingPoolOffer != null;
    return PopScope(
      canPop: !hasIncomingOffer,
      child: Stack(children: [
      AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        key: _scaffoldKey,
        backgroundColor: JT.bg,
        drawer: _buildDrawer(),
        bottomNavigationBar: _buildDriverBottomNav(),
        body: Stack(children: [
          // MAP BACKGROUND
          if (_navIndex == 0) ...[
            // Full-screen map (Deferred to prevent stutter)
            if (_mapReadyToLoad)
              Positioned.fill(
                child: GoogleMap(
                  initialCameraPosition: CameraPosition(target: _center, zoom: 14),
                  onMapCreated: (c) { _mapController = c; },
                  myLocationEnabled: true,
                  myLocationButtonEnabled: false,
                  zoomControlsEnabled: false,
                  mapToolbarEnabled: false,
                  markers: {
                    Marker(
                      markerId: const MarkerId('driver_location'),
                      position: _center,
                      icon: _selfIcon ??
                          BitmapDescriptor.defaultMarkerWithHue(
                              BitmapDescriptor.hueBlue),
                      rotation: _selfIcon != null ? _selfHeading : 0,
                      flat: _selfIcon != null,
                      anchor: const Offset(0.5, 0.5),
                      infoWindow: const InfoWindow(title: 'You are here'),
                    ),
                  },
                  circles: _heatmapCircles,
                ),
              )
            else
              Positioned.fill(
                child: Container(color: const Color(0xFFF1F5F9)),
              ),
              
            // Clean white gradient overlay at top for readability
            Positioned(
              top: 0, left: 0, right: 0,
              child: Container(
                height: 180,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.white.withValues(alpha: 0.95),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ],

          // TRIPS BACKGROUND
          if (_navIndex == 1)
            Positioned.fill(child: Container(color: Colors.white)),

          SafeArea(
            child: Column(children: [
              _buildTopBar(),
              
              if (_navIndex == 0) ...[
                const SizedBox(height: 10),
                const Spacer(),
                
                // Floating Location Button right above the bottom panel
                Align(
                  alignment: Alignment.centerRight,
                  child: Padding(
                    padding: const EdgeInsets.only(right: 20, bottom: 20),
                    child: GestureDetector(
                      onTap: _getLocation,
                      child: Container(
                        width: 50, height: 50,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.1), 
                              blurRadius: 15, 
                              offset: const Offset(0, 5),
                            )
                          ],
                        ),
                        child: const Icon(Icons.my_location_rounded, color: Color(0xFF0F172A), size: 24),
                      ),
                    ),
                  ),
                ),
                // Heatmap banner
                if (_isOnline && _nearestHighZone != null && _showHeatmap)
                  _buildHeatmapBanner(_nearestHighZone!),
                _buildBottomPanel(),
              ] else if (_navIndex == 1) ...[
                const Expanded(child: InlineTripsView()),
              ] else if (_navIndex == 2) ...[
                const Expanded(child: InlineEarningsView()),
              ] else if (_navIndex == 3) ...[
                const Expanded(child: InlineWalletView()),
              ] else if (_navIndex == 4) ...[
                Expanded(child: InlineRatingsView(rating: _driverRating)),
              ]
            ]),
          ),
          
          // Heatmap toggle button
          if (_navIndex == 0 && _isOnline)
            Positioned(
              right: 14,
              bottom: 100,
              child: _buildHeatmapToggle(),
            ),
        ]),
      ),
      ),
      if (hasIncomingOffer)
        Positioned.fill(
          child: IncomingOffersOverlay(
            trip: _incomingTrip,
            parcel: _incomingParcel,
            pool: _incomingPoolOffer,
            onAcceptTrip: () =>
                _acceptIncomingTrip(Map<String, dynamic>.from(_incomingTrip!)),
            onDeclineTrip: () =>
                _rejectIncomingTrip(Map<String, dynamic>.from(_incomingTrip!)),
            onAcceptParcel: () => _acceptIncomingParcel(
                Map<String, dynamic>.from(_incomingParcel!)),
            onDeclineParcel: _declineIncomingParcel,
            onAcceptPool: () => _acceptIncomingPoolOffer(
                Map<String, dynamic>.from(_incomingPoolOffer!)),
            onDeclinePool: _declineIncomingPoolOffer,
          ),
        ),
      ]),
    );
  }

  Widget _buildHeatmapBanner(HeatmapZone zone) {
    final color = zone.color;
    final icon = zone.demandLevel == 'high' ? Icons.local_fire_department_rounded : Icons.trending_up_rounded;

    return GestureDetector(
      onTap: () => _mapController?.animateCamera(CameraUpdate.newLatLngZoom(LatLng(zone.lat, zone.lng), 15)),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: AppCard.neonGlowBorder(color: color),
        child: Row(children: [
          Container(
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(color: color.withValues(alpha: 0.15), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(
              zone.demandLevel == 'high' ? '🔴 High demand zone ${_calcDist(zone)} away' : '🟡 Medium demand zone ${_calcDist(zone)} away',
              style: AppText.bodyPrimary(null),
            ),
            if (zone.earningMin > 0)
              Text(
                'Est. ₹${zone.earningMin}–₹${zone.earningMax} in 30 min',
                style: GoogleFonts.poppins(color: color, fontSize: 11, fontWeight: FontWeight.w400),
              ),
          ])),
          Icon(Icons.arrow_forward_ios_rounded, color: AppColors.textTertiary, size: 14),
        ]),
      ),
    );
  }

  String _calcDist(HeatmapZone zone) {
    final dLat = (zone.lat - _center.latitude) * 111.32;
    final dLng = (zone.lng - _center.longitude) * 111.32 * cos(_center.latitude * pi / 180);
    final d = sqrt(dLat * dLat + dLng * dLng);
    if (d < 1.0) return '${(d * 1000).toStringAsFixed(0)} m';
    return '${d.toStringAsFixed(1)} km';
  }

  Widget _buildHeatmapToggle() {
    return GestureDetector(
      onTap: _toggleHeatmap,
      child: Container(
        width: 46,
        height: 46,
        decoration: BoxDecoration(
          gradient: _showHeatmap ? AppColors.neonGrad : null,
          color: _showHeatmap ? null : Colors.white,
          shape: BoxShape.circle,
          border: Border.all(
            color: _showHeatmap ? AppColors.primary : AppColors.border,
            width: 1.5),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 8, offset: const Offset(0, 2))],
        ),
        child: Icon(
          Icons.layers_rounded,
          color: _showHeatmap ? Colors.white : AppColors.textTertiary,
          size: 20,
        ),
      ),
    );
  }

  Widget _buildTopBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Stack(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  _iconBtn(Icons.menu_rounded, () => _scaffoldKey.currentState?.openDrawer()),
                  const SizedBox(width: 10),
                  GestureDetector(
                    onTap: () {
                      Navigator.push(context, MaterialPageRoute(builder: (_) => const NotificationsScreen()))
                        .then((_) => _fetchUnreadCount());
                    },
                    child: Stack(children: [
                      Container(
                        width: 48, height: 48,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 4))],
                        ),
                        child: const Icon(Icons.notifications_none_rounded, color: Color(0xFF0F172A), size: 24),
                      ),
                      if (_unreadNotifCount > 0)
                        Positioned(
                          top: 10, right: 10,
                          child: Container(
                            width: 10, height: 10,
                            decoration: BoxDecoration(
                              color: const Color(0xFFEF4444),
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.white, width: 2),
                            ),
                          ),
                        ),
                    ]),
                  ),
                ],
              ),
              GestureDetector(
                onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const ProfileScreen())),
                child: Container(
                  width: 48, height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 4))],
                  ),
                  child: Center(
                    child: Container(
                      width: 32, height: 32,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF1F5F9), // Light slate gray background for avatar
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0xFFE2E8F0)),
                      ),
                      child: const Icon(Icons.person_rounded, color: Color(0xFF64748B), size: 20),
                    ),
                  ),
                ),
              ),
            ],
          ),
          Positioned.fill(
            child: Align(
              alignment: Alignment.topCenter,
              child: Padding(
                padding: const EdgeInsets.only(top: 12),
                child: JT.logoBlue(height: 64),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _iconBtn(IconData icon, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 48, height: 48,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 4))],
        ),
        child: Icon(icon, color: const Color(0xFF0F172A), size: 24),
      ),
    );
  }

  Widget _buildBottomPanel() {
    final panelFraction = _bottomPanelHeightFraction ?? 0.46;
    return Container(
      width: double.infinity,
      constraints: BoxConstraints(
        minHeight: MediaQuery.of(context).size.height * panelFraction,
        maxHeight: MediaQuery.of(context).size.height * panelFraction,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.only(topLeft: Radius.circular(32), topRight: Radius.circular(32)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 20, offset: const Offset(0, -4))],
      ),
      child: Column(children: [
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onVerticalDragUpdate: (details) {
            final screenH = MediaQuery.of(context).size.height;
            setState(() {
              _bottomPanelHeightFraction = (panelFraction - details.delta.dy / screenH)
                  .clamp(0.30, 0.62);
            });
          },
          child: Container(
            width: double.infinity,
            height: 26,
            alignment: Alignment.center,
            color: Colors.transparent,
            child: Container(
              width: 44,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFE2E8F0),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        ),
        Expanded(
          child: SingleChildScrollView(
            physics: const ClampingScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _userName.isNotEmpty ? _userName : 'Arjun Sharma',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF0F172A),
                      fontSize: 22,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -0.5,
                    ),
                  ),
                  Row(
                    children: [
                      Container(
                        width: 7,
                        height: 7,
                        decoration: BoxDecoration(color: _modeColors(_driverMode).first, shape: BoxShape.circle),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        switch (_driverMode) {
                          DriverServiceMode.cab => _isCabOrCarCategory ? 'Cab Service Active' : 'You are Online',
                          DriverServiceMode.carShare => 'Car Share Active',
                          DriverServiceMode.offline => 'You are Offline',
                        },
                        style: GoogleFonts.poppins(
                          color: const Color(0xFF64748B),
                          fontSize: 14,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 18),
          _buildModeSelector(),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: _buildNewStatCard(
                  color: const Color(0xFF2D8CFF),
                  icon: Icons.currency_rupee_rounded,
                  value: '₹${_earningsToday.toStringAsFixed(2)}',
                  label: 'Earnings',
                  onTap: () => setState(() => _navIndex = 2),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildNewStatCard(
                  color: const Color(0xFF22C55E),
                  icon: Icons.directions_car_rounded,
                  value: '$_tripsToday',
                  label: 'Trips',
                  onTap: () => setState(() => _navIndex = 1),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildNewStatCard(
                  color: const Color(0xFFF59E0B),
                  icon: Icons.star_rounded,
                  value: _driverRating.toStringAsFixed(1),
                  label: 'Rating',
                  onTap: () => setState(() => _navIndex = 4),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildNewStatCard(
                  color: const Color(0xFF7C3AED),
                  icon: Icons.account_balance_wallet_rounded,
                  value: '₹${_walletBalance.toStringAsFixed(2)}',
                  label: 'Wallet',
                  onTap: () => setState(() => _navIndex = 3),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          _buildNewVehicleCard(),
        ],
            ),
          ),
        ),
      ]),
    );
  }

  Widget _buildNewStatCard({
    required Color color,
    required IconData icon,
    required String value,
    required String label,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 105,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: color.withValues(alpha: 0.3),
              blurRadius: 10, offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 34, height: 34,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.25),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: Colors.white, size: 18),
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: GoogleFonts.poppins(
                color: Colors.white,
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              label,
              style: GoogleFonts.poppins(
                color: Colors.white.withValues(alpha: 0.9),
                fontSize: 12,
                fontWeight: FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _vehicleCategoryIcon(String category) {
    final t = category.toLowerCase();
    if (t.contains('bike') || t.contains('moto') || t.contains('scooter')) {
      return Icons.two_wheeler_rounded;
    }
    if (t.contains('auto') || t.contains('rickshaw')) return Icons.electric_rickshaw_rounded;
    if (t.contains('suv') || t.contains('xl')) return Icons.airport_shuttle_rounded;
    if (t.contains('sedan')) return Icons.time_to_leave_rounded;
    return Icons.directions_car_rounded;
  }

  Widget _buildNewVehicleCard() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE2E8F0), width: 1.5),
      ),
      child: Stack(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Container(
                      width: 46, height: 46,
                      decoration: const BoxDecoration(
                        color: Color(0xFFE0F2FE),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(_vehicleCategoryIcon(_vehicleCategory), color: const Color(0xFF2D8CFF), size: 24),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _vehicleCategory.isNotEmpty ? _vehicleCategory : 'My Vehicle',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF0F172A),
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          Text(
                            _vehicleNumber.isNotEmpty ? '$_vehicleNumber • $_vehicleModel' : 'AP37DP1235 • Gixxer',
                            style: GoogleFonts.poppins(
                              color: const Color(0xFF64748B),
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const Divider(color: Color(0xFFE2E8F0), height: 1.5),
                const SizedBox(height: 12),
                Row(
                  children: [
                    const Icon(Icons.calendar_month_rounded, color: Color(0xFF2D8CFF), size: 16),
                    const SizedBox(width: 6),
                    Text(
                      'RC Valid Till • 15 Dec 2025',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF64748B),
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          // FIX: this used to load a decorative bike image from
          // oyster-app-9e9cd.ondigitalocean.app - a different, unrelated DigitalOcean
          // app than this platform's actual domain (jagopro.org), and confirmed dead
          // (connection fails outright). No equivalent local asset exists to replace
          // it with, so the dead remote call is removed rather than pointed at another
          // guessed URL - it was already invisibly failing via the errorWidget fallback
          // chain to SizedBox.shrink(), just wastefully attempting a network connection
          // to a dead host on every render.
        ],
      ),
    );
  }

  Widget _buildDriverBottomNav() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: const Border(top: BorderSide(color: Color(0xFFF1F5F9), width: 1.5)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 20, offset: const Offset(0, -4))],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 64,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              _driverNavItem(Icons.home_rounded, 'Home', 0),
              _driverNavItem(Icons.fork_right_rounded, 'Trips', 1),
              _driverNavItem(Icons.bar_chart_rounded, 'Earnings', 2),
              _driverNavItem(Icons.account_balance_wallet_rounded, 'Wallet', 3),
            ],
          ),
        ),
      ),
    );
  }

  Widget _driverNavItem(IconData icon, String label, int index) {
    final active = _navIndex == index;
    return GestureDetector(
      onTap: () {
        setState(() => _navIndex = index);
        // All tabs handled inline — no Navigator.push needed
      },
      child: Container(
        color: Colors.transparent,
        width: 60,
        height: double.infinity,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (active)
              Container(width: 40, height: 3, margin: const EdgeInsets.only(bottom: 6), decoration: BoxDecoration(color: const Color(0xFF2D8CFF), borderRadius: BorderRadius.circular(2)))
            else
              const SizedBox(height: 9),
            Icon(icon, size: 24, color: active ? const Color(0xFF2D8CFF) : const Color(0xFF94A3B8)),
            const SizedBox(height: 4),
            Text(
              label,
              style: GoogleFonts.poppins(
                fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                fontSize: 11,
                color: active ? const Color(0xFF2D8CFF) : const Color(0xFF94A3B8),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDrawer() {
    return Drawer(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.only(topRight: Radius.circular(30), bottomRight: Radius.circular(30)),
      ),
      child: SafeArea(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            margin: const EdgeInsets.fromLTRB(20, 20, 20, 10),
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF2D8CFF), Color(0xFF1E6BE6)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(24),
              boxShadow: [BoxShadow(color: const Color(0xFF2D8CFF).withValues(alpha: 0.3), blurRadius: 20, offset: const Offset(0, 8))],
            ),
            child: Row(children: [
              Container(
                padding: const EdgeInsets.all(3),
                decoration: const BoxDecoration(color: Colors.white24, shape: BoxShape.circle),
                child: CircleAvatar(
                  radius: 28,
                  backgroundColor: Colors.white,
                  child: Text(
                    _userName.isNotEmpty ? _userName[0].toUpperCase() : 'P',
                    style: GoogleFonts.poppins(color: const Color(0xFF2D8CFF), fontSize: 24, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(
                    _userName,
                    style: GoogleFonts.poppins(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w600, letterSpacing: -0.3),
                    maxLines: 1, overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '+91 $_userPhone',
                    style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.8), fontSize: 13, fontWeight: FontWeight.w400),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.white.withValues(alpha: 0.1)),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      const Icon(Icons.verified_rounded, color: Colors.white, size: 14),
                      const SizedBox(width: 6),
                      JT.logoWhite(height: 12),
                    ]),
                  ),
                ]),
              ),
            ]),
          ),
          const SizedBox(height: 10),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              physics: const BouncingScrollPhysics(),
              children: [
                _drawerItem(Icons.grid_view_rounded, 'Dashboard', null, () {}),
                _drawerItem(Icons.local_atm_rounded, 'Earnings', '₹${_earningsToday.toStringAsFixed(0)}', () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const EarningsScreen()));
                }),
                _drawerItem(Icons.route_rounded, 'My Trips', null, () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const TripsHistoryScreen()));
                }),
                _drawerItem(Icons.account_balance_wallet_rounded, 'Wallet', '₹${_walletBalance.toStringAsFixed(0)}', () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const WalletScreen()));
                }),
                _drawerItem(Icons.person_outline_rounded, 'Profile', null, () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const ProfileScreen()));
                }),
                _drawerItem(Icons.verified_user_outlined, 'Activated Services', null, () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const ActivatedServicesScreen()));
                }),
                _drawerItem(Icons.health_and_safety_outlined, 'Safety & Fatigue', null, () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const FatigueScreen()));
                }),
                _drawerItem(Icons.headset_mic_outlined, 'Support', null, () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const DriverSupportChatScreen()));
                }),
                _drawerItem(Icons.card_giftcard_rounded, 'Refer & Earn', null, () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const ReferralScreen()));
                }),
                _drawerItem(Icons.groups_rounded, 'Local Pool', null, () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const LocalPoolScreen()));
                }),
                _drawerItem(Icons.route_rounded, 'Outstation Pool', null, () {
                  Navigator.pop(context);
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const OutstationPoolAvailabilityScreen()));
                }),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
            child: GestureDetector(
              onTap: () async {
                _socket.disconnect();
                OnlineKeepAliveService.stop();
                await AuthService.logout();
                if (!mounted) return;
                Navigator.pushAndRemoveUntil(
                  context,
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                  (_) => false,
                );
              },
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFEF4444).withValues(alpha: 0.3), width: 1.5),
                  boxShadow: [
                    BoxShadow(color: const Color(0xFFEF4444).withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 4)),
                  ],
                ),
                child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.logout_rounded, color: Color(0xFFEF4444), size: 20),
                  const SizedBox(width: 8),
                  Text(
                    'Logout',
                    style: GoogleFonts.poppins(
                      color: const Color(0xFFEF4444),
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ]),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 20),
            child: Center(
              child: Text(
                'v1.0.29 • MindWheel IT Solutions',
                style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 12, fontWeight: FontWeight.w400),
              ),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _drawerItem(IconData icon, String label, String? badge, VoidCallback onTap) {
    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          splashColor: const Color(0xFF2D8CFF).withValues(alpha: 0.05),
          highlightColor: const Color(0xFF2D8CFF).withValues(alpha: 0.05),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            child: Row(
              children: [
                Container(
                  width: 44, height: 44,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF8FAFC),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(icon, color: const Color(0xFF64748B), size: 22),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Text(
                    label,
                    style: GoogleFonts.poppins(
                      color: const Color(0xFF1E293B),
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                if (badge != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xFF10B981).withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      badge,
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF10B981),
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  )
                else
                  const Icon(Icons.chevron_right_rounded, color: Color(0xFFCBD5E1), size: 20),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class InlineTripsView extends StatefulWidget {
  const InlineTripsView({super.key});

  @override
  State<InlineTripsView> createState() => _InlineTripsViewState();
}

class _InlineTripsViewState extends State<InlineTripsView> {
  int _tabIndex = 0;
  bool _loading = true;
  List<Map<String, dynamic>> _trips = [];
  Map<String, dynamic> _stats = {'totalEarnings': 0, 'completed': 0, 'cancelled': 0};

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    if (!mounted) return;
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse(ApiConfig.driverTrips),
        headers: headers,
      ).timeout(const Duration(seconds: 8));

      if (res.statusCode == 200 && mounted) {
        final data = jsonDecode(res.body);
        final list = (data['trips'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
        
        // Always calculate local stats from the fetched list for immediate accuracy
        double calcEarnings = 0;
        int calcCompleted = 0;
        int calcCancelled = 0;
        
        for (var t in list) {
          final s = (t['currentStatus'] ?? t['status'] ?? '').toString().toLowerCase();
          if (s == 'completed') {
            calcCompleted++;
            calcEarnings += double.tryParse((t['actualFare'] ?? t['estimatedFare'] ?? 0).toString()) ?? 0;
          } else if (s == 'cancelled') {
            calcCancelled++;
          }
        }

        // Use server provided stats if they exist and are non-zero, otherwise use calculated
        final serverStats = data['stats'] as Map<String, dynamic>?;
        final stats = {
          'totalEarnings': (serverStats?['totalEarnings'] != null && (serverStats!['totalEarnings'] as num) > 0) 
              ? serverStats['totalEarnings'] 
              : calcEarnings,
          'completed': (serverStats?['completed'] != null && (serverStats!['completed'] as num) > 0) 
              ? serverStats['completed'] 
              : calcCompleted,
          'cancelled': (serverStats?['cancelled'] != null && (serverStats!['cancelled'] as num) > 0) 
              ? serverStats['cancelled'] 
              : calcCancelled,
        };

        setState(() {
          _trips = list;
          _stats = stats;
        });
      }
    } catch (e) {
      debugPrint('Error loading inline trips: $e');
    }
    if (mounted) setState(() => _loading = false);
  }

  String _formatDate(String? raw) {
    if (raw == null) return '';
    try {
      final dt = DateTime.parse(raw).toLocal();
      final months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      final h = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
      final ampm = dt.hour >= 12 ? 'PM' : 'AM';
      final m = dt.minute.toString().padLeft(2, '0');
      return '${dt.day} ${months[dt.month - 1]} · $h:$m $ampm';
    } catch (_) { return ''; }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'completed': return AppColors.success;
      case 'cancelled': return AppColors.error;
      case 'ongoing':
      case 'on_the_way': return AppColors.primary;
      case 'accepted':
      case 'driver_assigned': return const Color(0xFF8B5CF6);
      case 'arrived': return const Color(0xFFF59E0B);
      default: return AppColors.textTertiary;
    }
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      case 'ongoing':
      case 'on_the_way': return 'Ongoing';
      case 'accepted':
      case 'driver_assigned': return 'Assigned';
      case 'arrived': return 'Arrived';
      default: return status.toUpperCase();
    }
  }

  void _showTripDetail(Map<String, dynamic> t) {
    final status = (t['currentStatus'] ?? t['status'] ?? '').toString();
    final fare = double.tryParse((t['actualFare'] ?? t['estimatedFare'] ?? '0').toString()) ?? 0;
    final isPaid = (t['paymentStatus'] ?? '') == 'paid';
    final type = (t['type'] ?? 'ride').toString();
    final statusColor = _statusColor(status);

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.1), blurRadius: 20)],
        ),
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 44, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 24),
          Row(children: [
            Container(
              width: 56, height: 56,
              decoration: BoxDecoration(
                color: statusColor.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: statusColor.withValues(alpha: 0.2)),
              ),
              child: Icon(type == 'parcel' ? Icons.inventory_2_rounded : Icons.route_rounded, color: statusColor, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(type == 'parcel' ? 'Parcel Delivery' : 'Ride Request',
                style: GoogleFonts.poppins(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.w600)),
              Text(_formatDate(t['createdAt']?.toString()), style: GoogleFonts.poppins(color: AppColors.textTertiary, fontSize: 12)),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
              child: Text(_statusLabel(status), style: GoogleFonts.poppins(color: statusColor, fontSize: 12, fontWeight: FontWeight.w700)),
            ),
          ]),
          const SizedBox(height: 28),
          _detailRow(Icons.my_location_rounded, 'Pickup', t['pickupAddress']?.toString() ?? '—', AppColors.success),
          const SizedBox(height: 16),
          _detailRow(Icons.location_on_rounded, 'Drop', t['destinationAddress']?.toString() ?? '—', AppColors.error),
          const SizedBox(height: 28),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(20), border: Border.all(color: AppColors.border)),
            child: Row(children: [
              _tripStat('Fare', '₹${fare.toStringAsFixed(0)}', Icons.currency_rupee_rounded, AppColors.success),
              _vDivider(),
              _tripStat('Payment', isPaid ? 'Paid' : (t['paymentMethod']?.toString() ?? 'Cash'), isPaid ? Icons.check_circle_rounded : Icons.payments_rounded, isPaid ? AppColors.success : const Color(0xFFF59E0B)),
              _vDivider(),
              _tripStat('Distance', '${(double.tryParse(t['distanceKm']?.toString() ?? '0') ?? 0).toStringAsFixed(1)} km', Icons.straighten_rounded, AppColors.primary),
            ]),
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton(
              onPressed: () => Navigator.pop(context),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0F172A),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              child: Text('Close Details', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
            ),
          ),
        ]),
      ),
    );
  }

  Widget _detailRow(IconData icon, String label, String value, Color color) {
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(width: 36, height: 36, decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)), child: Icon(icon, color: color, size: 18)),
      const SizedBox(width: 14),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: GoogleFonts.poppins(color: AppColors.textTertiary, fontSize: 11, fontWeight: FontWeight.w500)),
        const SizedBox(height: 3),
        Text(value, style: GoogleFonts.poppins(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w500)),
      ])),
    ]);
  }

  Widget _tripStat(String label, String value, IconData icon, Color color) {
    return Expanded(child: Column(children: [
      Icon(icon, color: color, size: 20),
      const SizedBox(height: 8),
      Text(value, style: GoogleFonts.poppins(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w700)),
      Text(label, style: GoogleFonts.poppins(color: AppColors.textTertiary, fontSize: 10, fontWeight: FontWeight.w500)),
    ]));
  }

  Widget _vDivider() => Container(width: 1, height: 40, color: AppColors.border, margin: const EdgeInsets.symmetric(horizontal: 8));

  Widget _buildStatCard(String title, String value, Color bgColor, IconData icon) {
    return Expanded(
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(18),
          boxShadow: [BoxShadow(color: bgColor.withValues(alpha: 0.25), blurRadius: 12, offset: const Offset(0, 5))],
        ),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: const BoxDecoration(color: Colors.white24, shape: BoxShape.circle),
              child: Icon(icon, color: Colors.white, size: 16),
            ),
            const SizedBox(height: 10),
            Text(value, style: GoogleFonts.poppins(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
            const SizedBox(height: 2),
            Text(title, style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.85), fontSize: 10, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final filteredTrips = _trips.where((t) {
      final s = (t['currentStatus'] ?? t['status'] ?? '').toString().toLowerCase();
      if (_tabIndex == 1) return s == 'completed';
      if (_tabIndex == 2) return s == 'cancelled';
      return true;
    }).toList();

    return Container(
      color: Colors.white,
      child: _loading 
        ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
        : RefreshIndicator(
            onRefresh: _loadData,
            color: AppColors.primary,
            child: SingleChildScrollView(
              physics: const BouncingScrollPhysics(parent: AlwaysScrollableScrollPhysics()),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Trip Insights', style: GoogleFonts.poppins(color: AppColors.textPrimary, fontSize: 26, letterSpacing: -0.8, fontWeight: FontWeight.w700)),
                        GestureDetector(
                          onTap: _loadData,
                          child: Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              shape: BoxShape.circle,
                              border: Border.all(color: AppColors.border),
                              boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10)],
                            ),
                            child: const Icon(Icons.refresh_rounded, color: AppColors.textPrimary, size: 20),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Row(
                      children: [
                        _buildStatCard('Earnings', '₹${(double.tryParse(_stats['totalEarnings']?.toString() ?? '0') ?? 0).toStringAsFixed(0)}', const Color(0xFF10B981), Icons.currency_rupee_rounded),
                        _buildStatCard('Completed', '${_stats['completed'] ?? '0'}', AppColors.primary, Icons.check_circle_rounded),
                        _buildStatCard('Cancelled', '${_stats['cancelled'] ?? '0'}', AppColors.error, Icons.close_rounded),
                      ],
                    ),
                  ),
                  const SizedBox(height: 28),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Container(
                      height: 50,
                      padding: const EdgeInsets.all(5),
                      decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(25)),
                      child: Row(
                        children: [
                          _buildPillTab('All History', 0),
                          _buildPillTab('Completed', 1),
                          _buildPillTab('Cancelled', 2),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (filteredTrips.isEmpty)
                    _buildEmptyState()
                  else
                    ListView.builder(
                      shrinkWrap: true,
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: filteredTrips.length,
                      itemBuilder: (context, index) => _buildTripTile(filteredTrips[index]),
                    ),
                  const SizedBox(height: 120),
                ],
              ),
            ),
          ),
    );
  }

  Widget _buildTripTile(Map<String, dynamic> trip) {
    final rawStatus = (trip['currentStatus'] ?? trip['status'] ?? 'completed').toString().toLowerCase();
    final statusColor = _statusColor(rawStatus);
    final statusLabel = _statusLabel(rawStatus);
    final type = (trip['type'] ?? 'ride').toString();

    return GestureDetector(
      onTap: () => _showTripDetail(trip),
      child: Container(
        margin: const EdgeInsets.only(bottom: 16),
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: AppColors.border, width: 1.2),
          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 15, offset: const Offset(0, 5))],
        ),
        child: Column(
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.1), shape: BoxShape.circle),
                  child: Icon(type == 'parcel' ? Icons.inventory_2_rounded : Icons.route_rounded, color: statusColor, size: 16),
                ),
                const SizedBox(width: 12),
                Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(statusLabel, style: GoogleFonts.poppins(color: statusColor, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
                  Text(_formatDate(trip['createdAt']?.toString()), style: GoogleFonts.poppins(color: AppColors.textTertiary, fontSize: 11)),
                ]),
                const Spacer(),
                Text('₹${(double.tryParse((trip['actualFare'] ?? trip['estimatedFare'] ?? 0).toString()) ?? 0).toStringAsFixed(0)}', style: GoogleFonts.poppins(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.w700)),
              ],
            ),
            const SizedBox(height: 20),
            _buildLocationRow(Icons.circle, AppColors.success, trip['pickupShortName'] ?? trip['pickupAddress'] ?? 'Pickup'),
            Padding(
              padding: const EdgeInsets.only(left: 7, top: 4, bottom: 4),
              child: Container(width: 1.5, height: 18, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(1))),
            ),
            _buildLocationRow(Icons.location_on_rounded, AppColors.error, trip['destinationShortName'] ?? trip['destinationAddress'] ?? 'Destination'),
            const SizedBox(height: 18),
            const Divider(color: AppColors.border, thickness: 1),
            const SizedBox(height: 12),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(10), border: Border.all(color: AppColors.border)),
                  child: Row(children: [
                    const Icon(Icons.flash_on_rounded, color: const Color(0xFFF59E0B), size: 12),
                    const SizedBox(width: 6),
                    Text(trip['vehicleCategory']?.toString().toUpperCase() ?? 'RIDE', style: GoogleFonts.poppins(color: AppColors.textSecondary, fontSize: 10, fontWeight: FontWeight.w700)),
                  ]),
                ),
                const Spacer(),
                Icon(Icons.arrow_forward_ios_rounded, color: AppColors.textTertiary, size: 12),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLocationRow(IconData icon, Color color, String text) {
    return Row(
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 12),
        Expanded(child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: GoogleFonts.poppins(color: AppColors.textPrimary, fontSize: 14, fontWeight: FontWeight.w500))),
      ],
    );
  }

  Widget _buildEmptyState() {
    return Container(
      height: 400,
      alignment: Alignment.center,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 120, height: 120,
            decoration: BoxDecoration(color: AppColors.surface, shape: BoxShape.circle, border: Border.all(color: AppColors.border, width: 2)),
            child: const Icon(Icons.route_outlined, size: 50, color: AppColors.textTertiary),
          ),
          const SizedBox(height: 24),
          Text('No Trips Found', style: GoogleFonts.poppins(color: AppColors.textPrimary, fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text('Your complete trip history\nwill appear right here.', textAlign: TextAlign.center, style: GoogleFonts.poppins(color: AppColors.textTertiary, height: 1.5, fontSize: 15)),
        ],
      ),
    );
  }

  Widget _buildPillTab(String label, int index) {
    bool active = _tabIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _tabIndex = index),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: active ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(22),
            boxShadow: active ? [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 10, offset: const Offset(0, 2))] : [],
          ),
          child: Text(label, style: GoogleFonts.poppins(color: active ? AppColors.textPrimary : AppColors.textTertiary, fontSize: 13, fontWeight: active ? FontWeight.w700 : FontWeight.w500)),
        ),
      ),
    );
  }
}

// ─── Inline Earnings View ──────────────────────────────────────────────────

class InlineEarningsView extends StatefulWidget {
  const InlineEarningsView({super.key});
  @override
  State<InlineEarningsView> createState() => _InlineEarningsViewState();
}

class _InlineEarningsViewState extends State<InlineEarningsView>
    with SingleTickerProviderStateMixin {
  String _period = 'today';
  bool _loading = true;
  Map<String, dynamic> _stats = {};
  List<Map<String, dynamic>> _weekDays = [];
  double _weekTotal = 0;
  late AnimationController _fadeCtrl;
  late Animation<double> _fadeAnim;

  final _tabs = [
    {'label': 'Today', 'value': 'today'},
    {'label': 'Week', 'value': 'week'},
    {'label': 'Month', 'value': 'month'},
    {'label': 'All', 'value': 'all'},
  ];

  @override
  void initState() {
    super.initState();
    _fadeCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 500));
    _fadeAnim = CurvedAnimation(parent: _fadeCtrl, curve: Curves.easeOut);
    _loadData();
  }

  @override
  void dispose() {
    _fadeCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    if (mounted) setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/earnings?period=$_period'),
        headers: headers,
      ).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200 && mounted) {
        setState(() => _stats = jsonDecode(res.body));
        _fadeCtrl.forward(from: 0);
      }
      final resW = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/weekly-earnings'),
        headers: headers,
      ).timeout(const Duration(seconds: 8));
      if (resW.statusCode == 200 && mounted) {
        final d = jsonDecode(resW.body);
        setState(() {
          _weekDays = List<Map<String, dynamic>>.from(d['days'] ?? []);
          _weekTotal = (d['total'] ?? 0).toDouble();
        });
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    final net = (_stats['netEarnings'] ?? 0).toDouble();
    final gross = (_stats['grossFare'] ?? 0).toDouble();
    final commission = (_stats['commission'] ?? 0).toDouble();
    final completed = _stats['completedTrips'] ?? 0;
    final cancelled = _stats['cancelledTrips'] ?? 0;
    final maxWeek = _weekDays.isEmpty
        ? 1.0
        : _weekDays.map((d) => (d['gross'] as num).toDouble()).reduce((a, b) => a > b ? a : b).clamp(1.0, double.infinity);

    return Container(
      color: const Color(0xFFF8FAFC),
      child: SingleChildScrollView(
        physics: const BouncingScrollPhysics(),
        child: Column(
          children: [
            // ── Hero Balance Card ──
            Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF1E40AF), Color(0xFF3B82F6), Color(0xFF60A5FA)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(28),
                boxShadow: [BoxShadow(color: const Color(0xFF3B82F6).withValues(alpha: 0.35), blurRadius: 20, offset: const Offset(0, 10))],
              ),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('Net Earnings', style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.85), fontSize: 13, fontWeight: FontWeight.w500)),
                        const SizedBox(height: 4),
                        Text(
                          '₹${net.toStringAsFixed(2)}',
                          style: GoogleFonts.poppins(color: Colors.white, fontSize: 40, fontWeight: FontWeight.w700, letterSpacing: -1.5, height: 1.1),
                        ),
                      ]),
                      Container(
                        width: 60, height: 60,
                        decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.2), shape: BoxShape.circle, border: Border.all(color: Colors.white.withValues(alpha: 0.4))),
                        child: const Icon(Icons.trending_up_rounded, color: Colors.white, size: 30),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  // Period tabs
                  Container(
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(14)),
                    child: Row(
                      children: _tabs.map((t) {
                        final active = _period == t['value'];
                        return Expanded(
                          child: GestureDetector(
                            onTap: () { setState(() => _period = t['value']!); _loadData(); },
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              padding: const EdgeInsets.symmetric(vertical: 8),
                              decoration: BoxDecoration(
                                color: active ? Colors.white : Colors.transparent,
                                borderRadius: BorderRadius.circular(11),
                                boxShadow: active ? [BoxShadow(color: Colors.black.withValues(alpha: 0.1), blurRadius: 4)] : [],
                              ),
                              child: Text(t['label']!, textAlign: TextAlign.center,
                                style: GoogleFonts.poppins(
                                  color: active ? const Color(0xFF1E40AF) : Colors.white,
                                  fontSize: 12, fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                                )),
                            ),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                ],
              ),
            ),

            if (_loading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6), strokeWidth: 2.5)),
              )
            else
              FadeTransition(
                opacity: _fadeAnim,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: [
                      // ── 4 Stat Cards ──
                      Row(children: [
                        _statChip('Gross Fare', '₹${gross.toStringAsFixed(0)}', Icons.monetization_on_rounded, const Color(0xFFF59E0B), [const Color(0xFFFFFBEB), const Color(0xFFFEF3C7)]),
                        const SizedBox(width: 10),
                        _statChip('Commission', '-₹${commission.toStringAsFixed(0)}', Icons.percent_rounded, const Color(0xFFEF4444), [const Color(0xFFFEF2F2), const Color(0xFFFEE2E2)]),
                      ]),
                      const SizedBox(height: 10),
                      Row(children: [
                        _statChip('Completed', '$completed trips', Icons.check_circle_rounded, const Color(0xFF10B981), [const Color(0xFFECFDF5), const Color(0xFFD1FAE5)]),
                        const SizedBox(width: 10),
                        _statChip('Cancelled', '$cancelled trips', Icons.cancel_rounded, const Color(0xFF8B5CF6), [const Color(0xFFF5F3FF), const Color(0xFFEDE9FE)]),
                      ]),
                      const SizedBox(height: 16),

                      // ── Weekly Bar Chart ──
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(22),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 10, offset: const Offset(0, 4))],
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                            Text('Weekly Overview', style: GoogleFonts.poppins(color: const Color(0xFF0F172A), fontSize: 15, fontWeight: FontWeight.w700)),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(colors: [Color(0xFF3B82F6), Color(0xFF1E40AF)]),
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Text('₹${_weekTotal.toStringAsFixed(0)}', style: GoogleFonts.poppins(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w700)),
                            ),
                          ]),
                          const SizedBox(height: 24),
                          if (_weekDays.isEmpty)
                            Center(child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 20),
                              child: Text('No weekly data', style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 13)),
                            ))
                          else
                            SizedBox(
                              height: 130,
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                children: _weekDays.map((d) {
                                  final val = (d['gross'] as num).toDouble();
                                  final frac = val / maxWeek;
                                  final today = DateTime.now();
                                  final isToday = d['date'] == today.toIso8601String().substring(0, 10);
                                  return Expanded(
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(horizontal: 3),
                                      child: Column(mainAxisAlignment: MainAxisAlignment.end, children: [
                                        if (val > 0)
                                          Text('₹${val.toInt()}', style: GoogleFonts.poppins(color: isToday ? const Color(0xFF3B82F6) : const Color(0xFF94A3B8), fontSize: 8, fontWeight: FontWeight.w600)),
                                        const SizedBox(height: 4),
                                        Container(
                                          height: (frac * 90).clamp(4.0, 90.0),
                                          decoration: BoxDecoration(
                                            gradient: LinearGradient(
                                              colors: isToday
                                                  ? [const Color(0xFF60A5FA), const Color(0xFF1E40AF)]
                                                  : [const Color(0xFFE2E8F0), const Color(0xFFCBD5E1)],
                                              begin: Alignment.bottomCenter,
                                              end: Alignment.topCenter,
                                            ),
                                            borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
                                            boxShadow: isToday ? [BoxShadow(color: const Color(0xFF3B82F6).withValues(alpha: 0.3), blurRadius: 6)] : [],
                                          ),
                                        ),
                                        const SizedBox(height: 8),
                                        Text(d['day'] as String, style: GoogleFonts.poppins(color: isToday ? const Color(0xFF3B82F6) : const Color(0xFF94A3B8), fontSize: 10, fontWeight: isToday ? FontWeight.w700 : FontWeight.w500)),
                                      ]),
                                    ),
                                  );
                                }).toList(),
                              ),
                            ),
                        ]),
                      ),
                      const SizedBox(height: 20),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _statChip(String label, String value, IconData icon, Color color, List<Color> gradients) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 0),
        decoration: BoxDecoration(
          color: color, // fully solid vibrant background
          borderRadius: BorderRadius.circular(16),
          boxShadow: [BoxShadow(color: color.withValues(alpha: 0.35), blurRadius: 12, offset: const Offset(0, 6))],
        ),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Container(
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.25), shape: BoxShape.circle),
            child: Icon(icon, color: Colors.white, size: 16),
          ),
          const SizedBox(height: 8),
          Text(value, style: GoogleFonts.poppins(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w800)),
          const SizedBox(height: 2),
          Text(label, style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.9), fontSize: 10, fontWeight: FontWeight.w600)),
        ]),
      ),
    );
  }
}

// ─── Inline Wallet View ───────────────────────────────────────────────────

class InlineWalletView extends StatefulWidget {
  const InlineWalletView({super.key});
  @override
  State<InlineWalletView> createState() => _InlineWalletViewState();
}

class _InlineWalletViewState extends State<InlineWalletView> with SingleTickerProviderStateMixin {
  Map<String, dynamic>? _wallet;
  bool _loading = true;
  late TabController _tabController;
  late Razorpay _razorpay;
  double _pendingAmount = 0;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _razorpay = Razorpay();
    _razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _onPaymentSuccess);
    _razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _onPaymentError);
    _razorpay.on(Razorpay.EVENT_EXTERNAL_WALLET, _onExternalWallet);
    _fetchWallet();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _razorpay.clear();
    super.dispose();
  }

  Future<void> _fetchWallet() async {
    if (mounted) setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.driverWallet), headers: headers).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200 && mounted) {
        setState(() { _wallet = jsonDecode(res.body); _loading = false; });
      } else {
        if (mounted) setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onPaymentSuccess(PaymentSuccessResponse response) async {
    _showSnack('Processing payment...', error: false);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/wallet/verify-payment'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'razorpayOrderId': response.orderId, 'razorpayPaymentId': response.paymentId, 'razorpaySignature': response.signature, 'amount': _pendingAmount}),
      );
      if ((res.statusCode == 200 || res.statusCode == 409) && mounted) {
        final data = jsonDecode(res.body);
        _showSnack('₹${_pendingAmount.toInt()} added! New balance: ₹${data['newBalance']?.toStringAsFixed(2) ?? ''}');
        _fetchWallet();
      }
    } catch (_) {}
  }

  void _onPaymentError(PaymentFailureResponse r) { if (r.code != 0) _showSnack('Payment failed', error: true); }
  void _onExternalWallet(ExternalWalletResponse r) {}

  void _showSnack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg, style: GoogleFonts.poppins(fontWeight: FontWeight.w500)),
      backgroundColor: error ? const Color(0xFFEF4444) : const Color(0xFF10B981),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  Future<void> _initiateRecharge(double amount) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/wallet/create-order'),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({'amount': amount}),
      );
      if (res.statusCode != 200) { _showSnack('Failed to create payment order.', error: true); return; }
      final data = jsonDecode(res.body);
      _pendingAmount = amount;
      _razorpay.open({
        'key': data['keyId'] ?? '',
        'amount': data['order']['amount'],
        'currency': 'INR',
        'order_id': data['order']['id'],
        'name': 'JAGO Pro Pilot',
        'description': 'Wallet Recharge ₹${amount.toInt()}',
        'timeout': 300,
        'theme': {'color': '#2D8CFF'},
      });
    } catch (e) { _showSnack('Payment error: $e', error: true); }
  }

  void _showRechargeSheet() {
    double selectedAmount = 200;
    bool isCustom = false;
    final customCtrl = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: EdgeInsets.only(left: 24, right: 24, top: 24, bottom: MediaQuery.of(ctx).viewInsets.bottom + 32),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: const Color(0xFFE2E8F0), borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 20),
            Text('Recharge Wallet', style: GoogleFonts.poppins(color: const Color(0xFF0F172A), fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Current: ₹${(_wallet?['walletBalance'] ?? 0).toStringAsFixed(2)}', style: GoogleFonts.poppins(color: const Color(0xFF64748B), fontSize: 13)),
            const SizedBox(height: 20),
            Text('SELECT AMOUNT', style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 1.2)),
            const SizedBox(height: 12),
            Wrap(spacing: 10, runSpacing: 10, children: [
              for (final amt in [100.0, 200.0, 500.0, 1000.0])
                GestureDetector(
                  onTap: () => setSheet(() { selectedAmount = amt; isCustom = false; customCtrl.clear(); }),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 150),
                    padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 11),
                    decoration: BoxDecoration(
                      color: (!isCustom && selectedAmount == amt) ? const Color(0xFF2D8CFF) : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(26),
                      boxShadow: (!isCustom && selectedAmount == amt) ? [BoxShadow(color: const Color(0xFF2D8CFF).withValues(alpha: 0.3), blurRadius: 8)] : [],
                    ),
                    child: Text('₹${amt.toInt()}', style: GoogleFonts.poppins(color: (!isCustom && selectedAmount == amt) ? Colors.white : const Color(0xFF64748B), fontWeight: FontWeight.w600, fontSize: 15)),
                  ),
                ),
              GestureDetector(
                onTap: () => setSheet(() => isCustom = true),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 11),
                  decoration: BoxDecoration(color: isCustom ? const Color(0xFFFFF7ED) : const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(26), border: Border.all(color: isCustom ? const Color(0xFFF59E0B) : Colors.transparent)),
                  child: Text('Custom', style: GoogleFonts.poppins(color: isCustom ? const Color(0xFFF59E0B) : const Color(0xFF64748B), fontWeight: FontWeight.w600, fontSize: 15)),
                ),
              ),
            ]),
            if (isCustom) ...[
              const SizedBox(height: 14),
              TextField(
                controller: customCtrl,
                keyboardType: TextInputType.number,
                autofocus: true,
                onChanged: (v) => setSheet(() => selectedAmount = double.tryParse(v) ?? 0),
                style: GoogleFonts.poppins(color: const Color(0xFF0F172A), fontSize: 16),
                decoration: InputDecoration(
                  hintText: 'Enter amount',
                  hintStyle: GoogleFonts.poppins(color: const Color(0xFFCBD5E1)),
                  prefixText: '₹ ',
                  prefixStyle: GoogleFonts.poppins(color: const Color(0xFF2D8CFF), fontWeight: FontWeight.w600),
                  filled: true,
                  fillColor: const Color(0xFFF8FAFC),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: Color(0xFFE2E8F0))),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: const Color(0xFF2D8CFF), width: 1.5)),
                ),
              ),
            ],
            const SizedBox(height: 20),
            GestureDetector(
              onTap: selectedAmount < 1 ? null : () { Navigator.pop(ctx); _initiateRecharge(selectedAmount); },
              child: Container(
                width: double.infinity,
                height: 54,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(colors: [Color(0xFF2D8CFF), Color(0xFF1E40AF)]),
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [BoxShadow(color: const Color(0xFF2D8CFF).withValues(alpha: 0.35), blurRadius: 12, offset: const Offset(0, 6))],
                ),
                child: Center(child: Text('Pay ₹${selectedAmount.toInt()} via Razorpay', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15))),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final balance = (_wallet?['walletBalance'] ?? _wallet?['balance'] ?? 0).toDouble();
    final isLocked = _wallet?['isLocked'] ?? false;
    final history = (_wallet?['history'] ?? _wallet?['transactions'] ?? []) as List;
    final withdrawals = (_wallet?['withdrawRequests'] ?? []) as List;

    return Container(
      color: const Color(0xFFF8FAFC),
      child: Column(
        children: [
          // ── Compact Hero Balance Card ──
          Container(
            margin: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF065F46), Color(0xFF10B981), Color(0xFF34D399)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(24),
              boxShadow: [BoxShadow(color: const Color(0xFF10B981).withValues(alpha: 0.35), blurRadius: 18, offset: const Offset(0, 8))],
            ),
            child: Column(children: [
              // Top row: icon + balance
              Row(children: [
                Container(
                  width: 52, height: 52,
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.2), shape: BoxShape.circle, border: Border.all(color: Colors.white.withValues(alpha: 0.4))),
                  child: Icon(isLocked ? Icons.lock_rounded : Icons.account_balance_wallet_rounded, color: Colors.white, size: 26),
                ),
                const SizedBox(width: 14),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(isLocked ? 'Account Locked' : 'Available Balance',
                    style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.85), fontSize: 12, fontWeight: FontWeight.w500)),
                  Text('₹${balance.toStringAsFixed(2)}',
                    style: GoogleFonts.poppins(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w800, letterSpacing: -1, height: 1.1)),
                ])),
                GestureDetector(
                  onTap: () { setState(() => _loading = true); _fetchWallet(); },
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.2), shape: BoxShape.circle),
                    child: const Icon(Icons.refresh_rounded, color: Colors.white, size: 18),
                  ),
                ),
              ]),
              const SizedBox(height: 14),
              // Action buttons
              Row(children: [
                Expanded(
                  child: GestureDetector(
                    onTap: _showRechargeSheet,
                    child: Container(
                      height: 42,
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 6)]),
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        const Icon(Icons.add_circle_rounded, color: Color(0xFF10B981), size: 18),
                        const SizedBox(width: 6),
                        Text('Recharge', style: GoogleFonts.poppins(color: const Color(0xFF10B981), fontWeight: FontWeight.w700, fontSize: 13)),
                      ]),
                    ),
                  ),
                ),
                if (!isLocked && balance >= 100) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: Container(
                      height: 42,
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.white.withValues(alpha: 0.5))),
                      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        const Icon(Icons.arrow_upward_rounded, color: Colors.white, size: 16),
                        const SizedBox(width: 6),
                        Text('Withdraw', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                      ]),
                    ),
                  ),
                ],
              ]),
              if (isLocked) ...[
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
                  child: Row(children: [
                    const Icon(Icons.info_outline_rounded, color: Colors.white, size: 14),
                    const SizedBox(width: 7),
                    Expanded(child: Text('Recharge to unlock and go online.', style: GoogleFonts.poppins(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w500))),
                  ]),
                ),
              ],
            ]),
          ),

          // ── Quick Stats ──
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(children: [
              _walletStat('This Month', '₹0', const Color(0xFF3B82F6), Icons.calendar_month_rounded),
              const SizedBox(width: 10),
              _walletStat('Total Recharge', '₹0', const Color(0xFF8B5CF6), Icons.add_card_rounded),
              const SizedBox(width: 10),
              _walletStat('Withdrawn', '₹0', const Color(0xFFF59E0B), Icons.payment_rounded),
            ]),
          ),

          // ── Tab Bar ──
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(color: const Color(0xFFF1F5F9), borderRadius: BorderRadius.circular(16)),
              child: TabBar(
                controller: _tabController,
                indicator: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 6)]),
                indicatorSize: TabBarIndicatorSize.tab,
                dividerColor: Colors.transparent,
                labelColor: const Color(0xFF0F172A),
                unselectedLabelColor: const Color(0xFF94A3B8),
                labelStyle: GoogleFonts.poppins(fontWeight: FontWeight.w700, fontSize: 13),
                unselectedLabelStyle: GoogleFonts.poppins(fontWeight: FontWeight.w500, fontSize: 13),
                tabs: const [Tab(text: 'Transactions'), Tab(text: 'Withdrawals')],
              ),
            ),
          ),
          const SizedBox(height: 8),

          // ── Tab Content ──
          if (_loading)
            const Expanded(child: Center(child: CircularProgressIndicator(color: Color(0xFF10B981), strokeWidth: 2.5)))
          else
            Expanded(
              child: TabBarView(
                controller: _tabController,
                children: [
                  // Transactions
                  history.isEmpty
                    ? _emptyState(icon: Icons.receipt_long_rounded, title: 'No transactions yet', subtitle: 'Your recharges and ride earnings will appear here', color: const Color(0xFF3B82F6))
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        itemCount: history.length,
                        itemBuilder: (_, i) => _txnTile(history[i] as Map<String, dynamic>),
                      ),
                  // Withdrawals
                  withdrawals.isEmpty
                    ? _emptyState(icon: Icons.account_balance_rounded, title: 'No withdrawals yet', subtitle: 'Your withdrawal requests will appear here', color: const Color(0xFFF59E0B))
                    : ListView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                        itemCount: withdrawals.length,
                        itemBuilder: (_, i) => _withdrawTile(withdrawals[i] as Map<String, dynamic>),
                      ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _walletStat(String label, String value, Color color, IconData icon) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withValues(alpha: 0.15)),
          boxShadow: [BoxShadow(color: color.withValues(alpha: 0.06), blurRadius: 8, offset: const Offset(0, 3))],
        ),
        child: Column(children: [
          Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(color: color.withValues(alpha: 0.1), shape: BoxShape.circle), child: Icon(icon, color: color, size: 14)),
          const SizedBox(height: 6),
          Text(value, style: GoogleFonts.poppins(color: const Color(0xFF0F172A), fontSize: 14, fontWeight: FontWeight.w700)),
          Text(label, textAlign: TextAlign.center, style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 9.5, fontWeight: FontWeight.w500)),
        ]),
      ),
    );
  }

  Widget _txnTile(Map<String, dynamic> txn) {
    final isCredit = (txn['type'] ?? '').toString().toLowerCase().contains('credit') ||
        (txn['amount'] ?? 0) > 0;
    final color = isCredit ? const Color(0xFF10B981) : const Color(0xFFEF4444);
    final icon = isCredit ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded;
    final amt = (txn['amount'] ?? 0).toDouble().abs();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE2E8F0)), boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 6)]),
      child: Row(children: [
        Container(width: 40, height: 40, decoration: BoxDecoration(color: color.withValues(alpha: 0.1), shape: BoxShape.circle), child: Icon(icon, color: color, size: 18)),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(txn['description'] ?? txn['type'] ?? 'Transaction', style: GoogleFonts.poppins(color: const Color(0xFF0F172A), fontSize: 13, fontWeight: FontWeight.w600)),
          Text(txn['date'] ?? '', style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 11)),
        ])),
        Text('${isCredit ? '+' : '-'}₹${amt.toStringAsFixed(2)}', style: GoogleFonts.poppins(color: color, fontSize: 15, fontWeight: FontWeight.w700)),
      ]),
    );
  }

  Widget _withdrawTile(Map<String, dynamic> wd) {
    final status = wd['status'] ?? 'pending';
    final Color statusColor = status == 'completed' ? const Color(0xFF10B981) : status == 'rejected' ? const Color(0xFFEF4444) : const Color(0xFFF59E0B);
    final amt = (wd['amount'] ?? 0).toDouble();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFFE2E8F0))),
      child: Row(children: [
        Container(width: 40, height: 40, decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.1), shape: BoxShape.circle), child: Icon(Icons.account_balance_rounded, color: statusColor, size: 18)),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('₹${amt.toStringAsFixed(2)} Withdrawal', style: GoogleFonts.poppins(color: const Color(0xFF0F172A), fontSize: 13, fontWeight: FontWeight.w600)),
          Text(wd['method'] ?? 'bank', style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 11)),
        ])),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(8)),
          child: Text(status.toUpperCase(), style: GoogleFonts.poppins(color: statusColor, fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.5)),
        ),
      ]),
    );
  }

  Widget _emptyState({required IconData icon, required String title, required String subtitle, required Color color}) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Container(width: 80, height: 80, decoration: BoxDecoration(color: color.withValues(alpha: 0.1), shape: BoxShape.circle, border: Border.all(color: color.withValues(alpha: 0.2))),
            child: Icon(icon, color: color, size: 36)),
          const SizedBox(height: 20),
          Text(title, style: GoogleFonts.poppins(color: const Color(0xFF0F172A), fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          Text(subtitle, textAlign: TextAlign.center, style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 13, height: 1.5)),
        ]),
      ),
    );
  }
}

class InlineRatingsView extends StatefulWidget {
  final double rating;
  const InlineRatingsView({super.key, required this.rating});

  @override
  State<InlineRatingsView> createState() => _InlineRatingsViewState();
}

class _InlineRatingsViewState extends State<InlineRatingsView> {
  bool _loading = true;
  List<Map<String, dynamic>> _feedbacks = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    if (!mounted) return;
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.performance), headers: headers);
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() {
          _feedbacks = (data['feedbacks'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
        });
      }
    } catch (_) {}
    if (mounted) setState(() => _loading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.white,
      child: CustomScrollView(
        physics: const BouncingScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF2D8CFF), Color(0xFF1A50D0)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF2D8CFF).withValues(alpha: 0.3),
                      blurRadius: 15,
                      offset: const Offset(0, 8),
                    )
                  ],
                ),
                child: Column(children: [
                  Text(
                    'Overall Rating',
                    style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.9), fontSize: 14, fontWeight: FontWeight.w500),
                  ),
                  const SizedBox(height: 8),
                  Row(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                    Text(
                      widget.rating.toStringAsFixed(1),
                      style: GoogleFonts.poppins(color: Colors.white, fontSize: 48, fontWeight: FontWeight.w700, height: 1),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8, left: 4),
                      child: Text('/ 5.0', style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.8), fontSize: 18, fontWeight: FontWeight.w600)),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(5, (i) {
                      return Icon(
                        i < widget.rating.floor() ? Icons.star_rounded : Icons.star_outline_rounded,
                        color: Colors.amber,
                        size: 24,
                      );
                    }),
                  ),
                ]),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Text(
                'Recent Feedback',
                style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700, color: const Color(0xFF0F172A)),
              ),
            ),
          ),
          if (_loading)
            const SliverFillRemaining(child: Center(child: CircularProgressIndicator(color: Color(0xFF2D8CFF))))
          else if (_feedbacks.isEmpty)
            SliverFillRemaining(
              child: Center(
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Container(
                    width: 80, height: 80,
                    decoration: BoxDecoration(color: const Color(0xFFF1F5F9), shape: BoxShape.circle),
                    child: const Icon(Icons.star_outline_rounded, color: Color(0xFF94A3B8), size: 40),
                  ),
                  const SizedBox(height: 16),
                  Text('No ratings yet', style: GoogleFonts.poppins(fontWeight: FontWeight.w700, fontSize: 16, color: const Color(0xFF1E293B))),
                  const SizedBox(height: 4),
                  Text('Your customer reviews will appear here', style: GoogleFonts.poppins(color: const Color(0xFF64748B), fontSize: 13)),
                  const SizedBox(height: 100), // Push up for visual balance
                ]),
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) => _feedbackTile(_feedbacks[index]),
                  childCount: _feedbacks.length,
                ),
              ),
            ),
          const SliverPadding(padding: EdgeInsets.only(bottom: 100)),
        ],
      ),
    );
  }

  Widget _feedbackTile(Map<String, dynamic> f) {
    final stars = int.tryParse(f['rating']?.toString() ?? '5') ?? 5;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFF1F5F9)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 10)],
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text(f['customerName'] ?? 'Verified Rider', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 14, color: const Color(0xFF1E293B))),
          Row(children: List.generate(5, (i) => Icon(Icons.star_rounded, color: i < stars ? Colors.amber : const Color(0xFFE2E8F0), size: 14))),
        ]),
        const SizedBox(height: 8),
        if ((f['comment'] ?? '').isNotEmpty)
          Text('"${f['comment']}"', style: GoogleFonts.poppins(color: const Color(0xFF475569), fontSize: 13, fontStyle: FontStyle.italic, height: 1.4)),
        const SizedBox(height: 10),
        Text(f['date'] ?? 'Just now', style: GoogleFonts.poppins(color: const Color(0xFF94A3B8), fontSize: 11)),
      ]),
    );
  }
}
