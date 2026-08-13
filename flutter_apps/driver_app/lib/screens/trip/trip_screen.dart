import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:math' show min, max;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/api_retry.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import '../../services/call_service.dart';
import '../../services/trip_service.dart';
import 'package:jago_shared_core/jago_shared_core.dart';
import '../call/call_screen.dart';
import '../chat/trip_chat_sheet.dart';
import '../home/home_screen.dart';

// Quick polyline decoder (no extra package needed)
List<LatLng> _decodePolyline(String encoded) {
  final List<LatLng> pts = [];
  int index = 0;
  int lat = 0, lng = 0;
  while (index < encoded.length) {
    int b, shift = 0, result = 0;
    do {
      b = encoded.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    final dLat = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
    lat += dLat;
    shift = 0;
    result = 0;
    do {
      b = encoded.codeUnitAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    final dLng = ((result & 1) != 0 ? ~(result >> 1) : (result >> 1));
    lng += dLng;
    pts.add(LatLng(lat / 1e5, lng / 1e5));
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────────────

class TripScreen extends StatefulWidget {
  final Map<String, dynamic>? trip;
  const TripScreen({super.key, this.trip});
  @override
  State<TripScreen> createState() => _TripScreenState();
}

class _TripScreenState extends State<TripScreen>
    with TickerProviderStateMixin, WidgetsBindingObserver {
  final SocketService _socket = SocketService();
  final FlutterTts _tts = FlutterTts();
  GoogleMapController? _mapController;
  LatLng _center = const LatLng(17.3850, 78.4867);
  String _status = 'accepted';
  Map<String, dynamic>? _trip;
  bool _loading = false;
  double _arriveSlideOffset = 0;
  bool _nearPickup = false;
  final _otpCtrl = TextEditingController();
  Timer? _locationTimer;
  StreamSubscription<Position>? _posStream;
  Position? _lastTripPosition;
  Timer? _tripTimer;
  Timer? _statePollTimer; // 5s poll — server is source of truth
  List<String> _cancelReasons = [];
  StreamSubscription? _cancelSub;
  StreamSubscription? _incomingCallSub;
  StreamSubscription? _tripStatusSub;
  bool _locationWarningShown = false;
  bool _hasLiveLocationAccess = false;
  String _lastVoiceCue = '';
  final Set<Marker> _markers = {};
  final Set<Polyline> _polylines = {};

  // Live stats
  double _distanceToTargetM = 0;
  int _etaSec = 0;
  int _tripElapsedSec = 0;
  DateTime? _tripStartTime;

  // Animation for status pill
  late AnimationController _pulseCtrl;

  String _shortLocation(String v) {
    final s = v.trim();
    if (s.isEmpty) return s;
    return s.split(',').first.trim();
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _socket.setAppInBackground(false);
    _pulseCtrl = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 1200))
      ..repeat(reverse: true);
    _socket.connect(ApiConfig.socketUrl);
    _initVoiceGuidance();
    _trip = widget.trip;
    if (_trip != null) {
      _status = _trip!['currentStatus'] ?? _trip!['status'] ?? 'accepted';
      // Register active trip so socket can rejoin room on reconnect
      final tripId = _trip!['tripId'] ?? _trip!['id'];
      if (tripId != null) _socket.setActiveTrip(tripId.toString());
      final lat = double.tryParse(_trip!['pickupLat']?.toString() ??
          _trip!['pickup_lat']?.toString() ??
          '');
      final lng = double.tryParse(_trip!['pickupLng']?.toString() ??
          _trip!['pickup_lng']?.toString() ??
          '');
      if (lat != null && lng != null && lat != 0) _center = LatLng(lat, lng);
    }
    _startLocationUpdates();
    _startStatePoll();
    _loadCancelReasons();
    _listenForCancel();
    _listenForTripStatus();
    CallService().init();
    _listenForIncomingCalls();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _initMapMarkers();
      _fetchRouteForCurrentStatus();
      if (_status == 'in_progress' || _status == 'on_the_way') {
        _startTripTimer();
      }
      _validateActiveTrip();
    });
    debugPrint(
        '[TRIP] Screen init — tripId=${_trip?['tripId'] ?? _trip?['id']} status=$_status');
  }

  // ── Validate trip still active on screen load ─────────────────────────────

  Future<void> _validateActiveTrip() async {
    final tripId = _trip?['tripId'] ?? _trip?['id'];
    if (tripId == null) return;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.driverActiveTrip),
          headers: headers).timeout(const Duration(seconds: 8));
      if (!mounted) return;
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final serverTrip = data['trip'];
        if (serverTrip == null) {
          // No active trip on server — this screen is stale
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
                content: Text('Trip no longer active. Returning home.'),
                backgroundColor: Colors.orange),
          );
          Navigator.pushAndRemoveUntil(
              context,
              MaterialPageRoute(builder: (_) => const HomeScreen()),
              (_) => false);
        }
      }
    } catch (_) {
      // Network error — keep screen, socket cancel handler will catch real cancels
    }
  }

  // ── State polling — server is source of truth ────────────────────────────

  void _startStatePoll() {
    _statePollTimer?.cancel();
    _statePollTimer =
        Timer.periodic(const Duration(seconds: 5), (_) => _syncTripState());
  }

  void _stopStatePoll() {
    _statePollTimer?.cancel();
    _statePollTimer = null;
  }

  Future<void> _syncTripState() async {
    if (!mounted) return;
    final tripId = _trip?['tripId'] ?? _trip?['id'];
    if (tripId == null) return;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.driverActiveTrip), headers: headers)
          .timeout(const Duration(seconds: 4));
      if (!mounted) return;
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final serverTrip = data['trip'] as Map<String, dynamic>?;
        if (serverTrip == null) {
          // Trip ended on server — pop to home
          _stopStatePoll();
          if (mounted) {
            Navigator.pushAndRemoveUntil(
                context,
                MaterialPageRoute(builder: (_) => const HomeScreen()),
                (_) => false);
          }
          return;
        }
        final serverStatus =
            (serverTrip['currentStatus'] ?? serverTrip['current_status'] ?? '')
                .toString();
        if (serverStatus == 'completed' || serverStatus == 'cancelled') {
          _stopStatePoll();
          if (mounted) {
            Navigator.pushAndRemoveUntil(
                context,
                MaterialPageRoute(builder: (_) => const HomeScreen()),
                (_) => false);
          }
          return;
        }
        // Sync status if server differs from local (handles race conditions)
        if (serverStatus.isNotEmpty && serverStatus != _status) {
          final previousStatus = _status;
          setState(() {
            _status = serverStatus;
            _trip = serverTrip;
          });
          // Route + nav triggers based on new server-authoritative status
          _fetchRouteForCurrentStatus();
          if ((serverStatus == 'in_progress' || serverStatus == 'on_the_way') &&
              previousStatus != 'in_progress' &&
              previousStatus != 'on_the_way') {
            _startTripTimer();
          }
          debugPrint('[TRIP] Poll sync: $previousStatus → $serverStatus');
        }
      }
    } catch (_) {} // network error — keep polling
  }

  // ── Timers ────────────────────────────────────────────────────────────────

  void _startTripTimer() {
    _tripStartTime ??= DateTime.now();
    _tripTimer?.cancel();
    _tripTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {
        _tripElapsedSec = DateTime.now().difference(_tripStartTime!).inSeconds;
      });
    });
  }

  void _stopTripTimer() {
    _tripTimer?.cancel();
    _tripTimer = null;
  }

  String _formatElapsed(int secs) {
    final m = (secs ~/ 60).toString().padLeft(2, '0');
    final s = (secs % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  String _formatEta(int secs) {
    if (secs <= 0) return '--';
    if (secs < 60) return '< 1 min';
    final mins = (secs / 60).ceil();
    if (mins < 60) return '$mins min';
    return '${(mins / 60).floor()}h ${mins % 60}m';
  }

  String _formatDist(double m) {
    if (m <= 0) return '--';
    if (m < 1000) return '${m.round()} m';
    return '${(m / 1000).toStringAsFixed(1)} km';
  }

  bool get _isHeadingToPickup =>
      _status == 'accepted' || _status == 'driver_assigned';

  bool get _isTripLive =>
      _status == 'in_progress' || _status == 'on_the_way';

  bool get _isAtPickup => _status == 'arrived';

  String get _stageTitle {
    if (_isTripLive) return 'Go to Drop';
    if (_isAtPickup) return 'Meet the Customer';
    return 'Go to Pickup Zone';
  }

  double get _currentSpeedKmph {
    final speed = _lastTripPosition?.speed ?? 0;
    return speed > 0 ? speed * 3.6 : 0;
  }

  double _resolveCoord(List<String> keys) {
    for (final key in keys) {
      final value = double.tryParse(_trip?[key]?.toString() ?? '');
      if (value != null && value != 0) return value;
    }
    return 0;
  }

  String _resolveTargetLabel() {
    if (_isHeadingToPickup) {
      return _shortLocation((_trip?['pickupShortName'] ??
              _trip?['pickupAddress'] ??
              _trip?['pickup_address'] ??
              'Pickup')
          .toString());
    }
    return _shortLocation((_trip?['destinationShortName'] ??
            _trip?['destinationAddress'] ??
            _trip?['destination_address'] ??
            'Destination')
        .toString());
  }

  String _resolveTargetAddress() {
    if (_isHeadingToPickup) {
      return (_trip?['pickupAddress'] ?? _trip?['pickup_address'] ?? '')
          .toString();
    }
    return (_trip?['destinationAddress'] ?? _trip?['destination_address'] ?? '')
        .toString();
  }

  Future<void> _focusRouteOnMap({bool showReadySnack = false}) async {
    final tLat = _isHeadingToPickup
        ? _resolveCoord(['pickupLat', 'pickup_lat'])
        : _resolveCoord(['destinationLat', 'destination_lat']);
    final tLng = _isHeadingToPickup
        ? _resolveCoord(['pickupLng', 'pickup_lng'])
        : _resolveCoord(['destinationLng', 'destination_lng']);
    if (tLat == 0 || tLng == 0) return;

    final origin = _lastTripPosition;
    final fromLat = origin?.latitude ?? _center.latitude;
    final fromLng = origin?.longitude ?? _center.longitude;
    await _fetchRoute(fromLat, fromLng, tLat, tLng);

    if (_mapController != null) {
      final swLat = min(fromLat, tLat);
      final swLng = min(fromLng, tLng);
      final neLat = max(fromLat, tLat);
      final neLng = max(fromLng, tLng);
      await _mapController!.animateCamera(
        CameraUpdate.newLatLngBounds(
          LatLngBounds(
            southwest: LatLng(swLat, swLng),
            northeast: LatLng(neLat, neLng),
          ),
          84,
        ),
      );
      if (showReadySnack) {
        _showSnack('Route ready inside app for ${_resolveTargetLabel()}');
      }
    }
  }

  // ── Socket listeners ──────────────────────────────────────────────────────

  void _listenForCancel() {
    _cancelSub = _socket.onTripCancelled.listen((data) {
      if (!mounted) return;
      final incomingTripId = data['tripId']?.toString() ??
          data['trip_id']?.toString() ??
          data['id']?.toString() ??
          '';
      final currentTripId =
          _trip?['id']?.toString() ?? _trip?['tripId']?.toString() ?? '';
      if (incomingTripId.isEmpty ||
          currentTripId.isEmpty ||
          incomingTripId != currentTripId) {
        return;
      }
      if (_isTripLive) {
        _syncTripState();
        return;
      }
      _locationTimer?.cancel();
      _stopTripTimer();
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (_) => AlertDialog(
          backgroundColor: JT.surface,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: Text('Trip Cancelled',
              style: GoogleFonts.poppins(
                  color: JT.textPrimary, fontWeight: FontWeight.w400)),
          content: Text('Customer cancelled the trip.',
              style:
                  GoogleFonts.poppins(color: JT.textSecondary, fontSize: 14)),
          actions: [
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                  backgroundColor: JT.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10))),
              onPressed: () {
                Navigator.pop(context);
                Navigator.pushAndRemoveUntil(
                    context,
                    MaterialPageRoute(builder: (_) => const HomeScreen()),
                    (_) => false);
              },
              child: const Text('OK',
                  style: TextStyle(fontWeight: FontWeight.w500)),
            ),
          ],
        ),
      );
    });
  }

  void _listenForIncomingCalls() {
    _incomingCallSub = _socket.onCallIncoming.listen((data) {
      if (!mounted) return;
      final callerName = data['callerName']?.toString() ?? 'Customer';
      final callerId = data['callerId']?.toString() ?? '';
      final tripId =
          data['tripId']?.toString() ?? (_trip?['id']?.toString() ?? '');
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => CallScreen(
          contactName: callerName,
          tripId: tripId,
          targetUserId: callerId,
          isIncoming: true,
          callerIdForIncoming: callerId,
        ),
      ));
    });
  }

  void _listenForTripStatus() {
    _tripStatusSub = _socket.onTripStatus.listen((data) {
      if (!mounted) return;
      final incomingTripId = data['tripId']?.toString() ?? '';
      final currentTripId =
          _trip?['id']?.toString() ?? _trip?['tripId']?.toString() ?? '';
      if (incomingTripId.isEmpty ||
          currentTripId.isEmpty ||
          incomingTripId != currentTripId) {
        return;
      }
      final incomingStatus = data['status']?.toString() ?? '';
      if (incomingStatus.isEmpty) return;
      setState(() {
        _status = incomingStatus;
        _trip = _mergeTripState(_trip, data);
        _loading = false;
      });
      if (_isTripLive) {
        _startTripTimer();
      }
      _fetchRouteForCurrentStatus();
      _announceStatusCue(incomingStatus);
    });
  }

  Map<String, dynamic>? _mergeTripState(
      Map<String, dynamic>? previousTrip, Map<String, dynamic>? nextTrip) {
    if (previousTrip == null) {
      return nextTrip == null ? null : Map<String, dynamic>.from(nextTrip);
    }
    if (nextTrip == null) return previousTrip;
    final merged = Map<String, dynamic>.from(previousTrip);
    nextTrip.forEach((key, value) {
      final lower = key.toLowerCase();
      final isCoord = lower.contains('lat') || lower.contains('lng');
      final asString = value?.toString().trim() ?? '';
      if (isCoord && (value == null || asString.isEmpty || asString == '0' || asString == '0.0')) {
        return;
      }
      merged[key] = value;
    });
    for (final field in [
      'id',
      'tripId',
      'pickupLat',
      'pickupLng',
      'pickup_lat',
      'pickup_lng',
      'destinationLat',
      'destinationLng',
      'destination_lat',
      'destination_lng',
      'pickupAddress',
      'destinationAddress',
    ]) {
      merged[field] ??= previousTrip[field];
    }
    return merged;
  }

  Future<void> _refreshTripFromServer({bool openOtpIfArrived = false}) async {
    final tripId = _trip?['id']?.toString() ?? _trip?['tripId']?.toString() ?? '';
    if (tripId.isEmpty) return;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.driverActiveTrip), headers: headers)
          .timeout(const Duration(seconds: 6));
      if (!mounted || res.statusCode != 200) return;
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final serverTrip = data['trip'] as Map<String, dynamic>?;
      if (serverTrip == null) return;
      final serverTripId =
          serverTrip['id']?.toString() ?? serverTrip['tripId']?.toString() ?? '';
      if (serverTripId != tripId) return;
      final serverStatus =
          (serverTrip['currentStatus'] ?? serverTrip['current_status'] ?? _status)
              .toString();
      setState(() {
        _trip = _mergeTripState(_trip, serverTrip);
        _status = serverStatus;
      });
      _fetchRouteForCurrentStatus();
      _announceStatusCue(serverStatus);
      if (openOtpIfArrived && _status == 'arrived') {
        _showOtpBottomSheet();
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _otpCtrl.dispose();
    _locationTimer?.cancel();
    _posStream?.cancel();
    _stopTripTimer();
    _stopStatePoll();
    _cancelSub?.cancel();
    _incomingCallSub?.cancel();
    _tripStatusSub?.cancel();
    _pulseCtrl.dispose();
    try {
      _tts.stop();
    } catch (_) {}
    _mapController?.dispose();
    super.dispose();
  }

  Future<void> _initVoiceGuidance() async {
    try {
      await _tts.setLanguage('en-IN');
      await _tts.setSpeechRate(0.45);
      await _tts.setVolume(1.0);
      await _tts.setPitch(1.0);
    } catch (_) {}
  }

  Future<void> _speakCue(String message, {String? dedupeKey}) async {
    final key = dedupeKey ?? message;
    if (key == _lastVoiceCue) return;
    _lastVoiceCue = key;
    try {
      await _tts.stop();
      await _tts.speak(message);
    } catch (_) {}
  }

  void _announceStatusCue(String status) {
    if (!mounted) return;
    if (status == 'accepted' || status == 'driver_assigned') {
      _speakCue(
        'Trip accepted. Follow the in app route to pickup.',
        dedupeKey: 'status_pickup',
      );
    } else if (status == 'arrived') {
      _speakCue(
        'You have arrived at pickup. Ask the customer for OTP.',
        dedupeKey: 'status_arrived',
      );
    } else if (status == 'in_progress' || status == 'on_the_way') {
      _speakCue(
        'Trip started. Follow the in app route to destination.',
        dedupeKey: 'status_destination',
      );
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _socket.setAppInBackground(false);
      if (!_socket.isConnected) {
        _socket.connect(ApiConfig.socketUrl);
      }
      final tid = _trip?['id']?.toString() ?? _trip?['tripId']?.toString();
      if (tid != null) {
        _socket.setActiveTrip(tid);
      }
      if (_posStream == null || _locationTimer == null) {
        _startLocationUpdates();
      }
      _syncTripState();
      return;
    }
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.inactive ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      _socket.setAppInBackground(true);
    }
  }

  // ── Map & Route ───────────────────────────────────────────────────────────

  void _initMapMarkers() async {
    if (!mounted || _trip == null) return;
    final pLat = double.tryParse(_trip!['pickupLat']?.toString() ??
        _trip!['pickup_lat']?.toString() ??
        '');
    final pLng = double.tryParse(_trip!['pickupLng']?.toString() ??
        _trip!['pickup_lng']?.toString() ??
        '');
    final dLat = double.tryParse(_trip!['destinationLat']?.toString() ??
        _trip!['destination_lat']?.toString() ??
        '');
    final dLng = double.tryParse(_trip!['destinationLng']?.toString() ??
        _trip!['destination_lng']?.toString() ??
        '');
    final pickupIcon = await JagoMapMarkers.pickup();
    final destinationIcon = await JagoMapMarkers.destination();
    if (!mounted) return;
    setState(() {
      _markers.clear();
      if (pLat != null && pLat != 0 && pLng != null) {
        _markers.add(Marker(
          markerId: const MarkerId('pickup'),
          position: LatLng(pLat, pLng),
          icon: pickupIcon,
          anchor: const Offset(0.5, 0.9),
          infoWindow: InfoWindow(
            title: 'Pickup',
            snippet: _shortLocation(
                (_trip!['pickupShortName'] ?? _trip!['pickupAddress'] ?? '')
                    .toString()),
          ),
        ));
      }
      if (dLat != null && dLat != 0 && dLng != null) {
        _markers.add(Marker(
          markerId: const MarkerId('destination'),
          position: LatLng(dLat, dLng),
          icon: destinationIcon,
          anchor: const Offset(0.5, 0.9),
          infoWindow: InfoWindow(
            title: 'Drop',
            snippet: _shortLocation((_trip!['destinationShortName'] ??
                    _trip!['destinationAddress'] ??
                    '')
                .toString()),
          ),
        ));
      }
    });
  }

  String _tripVehicleType() {
    return (_trip?['vehicleCategory'] ??
            _trip?['vehicleCategoryName'] ??
            _trip?['vehicleName'] ??
            _trip?['vehicleType'] ??
            _trip?['vehicle_type'] ??
            _trip?['tripType'] ??
            'cab')
        .toString();
  }

  void _updateSelfMarker(double lat, double lng, {double rotation = 0}) async {
    final selfIcon = await JagoMapMarkers.vehicle(_tripVehicleType());
    if (!mounted) return;
    setState(() {
      _markers.removeWhere((m) => m.markerId.value == 'self');
      _markers.add(Marker(
        markerId: const MarkerId('self'),
        position: LatLng(lat, lng),
        icon: selfIcon,
        infoWindow: const InfoWindow(title: 'You'),
        zIndexInt: 2,
        rotation: rotation.isFinite ? rotation : 0,
        flat: true,
        anchor: const Offset(0.5, 0.5),
      ));
    });
  }

  Future<void> _showLocationPrompt({
    required String title,
    required String message,
    required Future<bool> Function() openSettings,
  }) async {
    if (!mounted || _locationWarningShown) return;
    _locationWarningShown = true;
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

  Future<Position?> _resolveTripLocation() async {
    Position? fallback;
    try {
      fallback = await Geolocator.getLastKnownPosition();
    } catch (_) {}

    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      _hasLiveLocationAccess = false;
      if (fallback != null) return fallback;
      await _showLocationPrompt(
        title: 'Location Services Off',
        message:
            'Turn on device location so the customer can see your live trip movement.',
        openSettings: Geolocator.openLocationSettings,
      );
      return null;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.deniedForever) {
      _hasLiveLocationAccess = false;
      if (fallback != null) return fallback;
      await _showLocationPrompt(
        title: 'Location Required',
        message:
            'Location access is required during trips so the customer can track you live.',
        openSettings: Geolocator.openAppSettings,
      );
      return null;
    }
    _hasLiveLocationAccess = true;

    try {
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 10),
        ),
      );
    } catch (_) {
      return fallback;
    }
  }

  Future<void> _fetchRouteForCurrentStatus() async {
    final t = _trip;
    if (t == null) return;
    // Use best available GPS origin: prefer real GPS > last cached > map center
    final origin = _lastTripPosition;
    final myLat = origin?.latitude ?? _center.latitude;
    final myLng = origin?.longitude ?? _center.longitude;

    final toPickup = _status == 'accepted' || _status == 'driver_assigned';

    double destLat, destLng;
    if (toPickup) {
      destLat = double.tryParse(t['pickupLat']?.toString() ??
              t['pickup_lat']?.toString() ??
              '') ??
          0;
      destLng = double.tryParse(t['pickupLng']?.toString() ??
              t['pickup_lng']?.toString() ??
              '') ??
          0;
    } else {
      destLat = double.tryParse(t['destinationLat']?.toString() ??
              t['destination_lat']?.toString() ??
              '') ??
          0;
      destLng = double.tryParse(t['destinationLng']?.toString() ??
              t['destination_lng']?.toString() ??
              '') ??
          0;
    }
    if (destLat == 0 || destLng == 0) {
      debugPrint('[ROUTE] Skipping fetch — no valid destination coords (status=$_status)');
      return;
    }
    debugPrint('[ROUTE] Fetching route from ($myLat,$myLng) → ($destLat,$destLng) [status=$_status]');
    await _fetchRoute(myLat, myLng, destLat, destLng);
  }

  Future<void> _fetchRoute(
      double fromLat, double fromLng, double toLat, double toLng) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .post(
            Uri.parse(ApiConfig.routeMultiWaypoint),
            headers: {...headers, 'Content-Type': 'application/json'},
            body: jsonEncode({
              'origin': {'lat': fromLat, 'lng': fromLng},
              'destination': {'lat': toLat, 'lng': toLng},
              'waypoints': [],
              'optimize': false,
            }),
          )
          .timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final overviewPolyline = data['overviewPolyline']?.toString();
        final distKm = (data['totalDistanceKm'] as num?)?.toDouble() ?? 0.0;
        final durMin =
            (data['totalDurationMinutes'] as num?)?.toDouble() ?? 0.0;
        if (overviewPolyline != null && mounted) {
          final pts = _decodePolyline(overviewPolyline);
          setState(() {
            _polylines.clear();
            _polylines.add(Polyline(
              polylineId: const PolylineId('route'),
              points: pts,
              color: JT.primary,
              width: 5,
              patterns: [],
            ));
            _distanceToTargetM = distKm * 1000;
            _etaSec = (durMin * 60).round();
          });
        }
      } else if (res.statusCode != 200) {
        if (mounted) {
          String msg = 'Could not load route';
          try {
            msg = (jsonDecode(res.body) as Map)['message']?.toString() ?? msg;
          } catch (_) {}
          _showSnack(msg, error: true);
        }
      }
    } catch (e) {
      if (mounted) _showSnack('Route unavailable. Check connection.', error: true);
    }
  }

  // ── Location updates ──────────────────────────────────────────────────────

  Future<void> _startLocationUpdates() async {
    _locationTimer?.cancel();
    _posStream?.cancel();

    final initialPos = await _resolveTripLocation();
    if (initialPos == null) {
      _showSnack(
          'Live location is unavailable. Enable GPS to continue trip tracking.',
          error: true);
      return;
    }
    _lastTripPosition = initialPos;
    if (mounted) {
      setState(
          () => _center = LatLng(initialPos.latitude, initialPos.longitude));
      _updateSelfMarker(
        initialPos.latitude,
        initialPos.longitude,
        rotation: initialPos.heading,
      );
      // Now that we have real GPS, re-fetch route with accurate origin
      _fetchRouteForCurrentStatus();
    }
    if (!_hasLiveLocationAccess) {
      _showSnack('Enable GPS permission to resume live customer tracking.',
          error: true);
      return;
    }

    // GPS stream: high-accuracy (active trip), but emits only on movement ≥ 5 m
    _posStream = Geolocator.getPositionStream(
      locationSettings: Platform.isIOS
          ? const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 5)
          : AndroidSettings(
              accuracy: LocationAccuracy.high,
              distanceFilter: 5,
              intervalDuration: Duration(seconds: 3),
              foregroundNotificationConfig: ForegroundNotificationConfig(
                notificationText: 'JAGO Pro Pilot is sharing your live trip location',
                notificationTitle: 'Trip tracking active',
                enableWakeLock: true,
                setOngoing: true,
              ),
            ),
    ).listen((pos) {
      if (pos.isMocked) {
        debugPrint('[FRAUD] Mock GPS in active trip — ignoring');
        return;
      }
      final prev = _lastTripPosition;
      if (prev != null) {
        final distM = Geolocator.distanceBetween(
            prev.latitude, prev.longitude, pos.latitude, pos.longitude);
        final elapsed = pos.timestamp.difference(prev.timestamp).inSeconds.abs();
        if (elapsed > 0 && (distM / elapsed) * 3.6 > 150) {
          debugPrint('[FRAUD] Speed anomaly in trip — ignoring');
          return;
        }
        if (distM > 500 && elapsed < 5) {
          debugPrint('[FRAUD] Teleport in trip — ignoring');
          return;
        }
      }
      _lastTripPosition = pos;
      if (!mounted) return;
      setState(() => _center = LatLng(pos.latitude, pos.longitude));
      _mapController?.animateCamera(CameraUpdate.newLatLng(_center));
      _updateSelfMarker(
        pos.latitude,
        pos.longitude,
        rotation: pos.heading,
      );
      _computeDistanceAndEta(pos.latitude, pos.longitude);
    }, onError: (e) {
      debugPrint('[GPS] Stream error in trip: $e — attempting recovery in 5s');
      if (!mounted) return;
      _showSnack('GPS signal lost. Reconnecting...', error: true);
      Future.delayed(const Duration(seconds: 5), () {
        if (!mounted) return;
        _posStream?.cancel();
        _posStream = null;
        _startLocationUpdates();
      });
    });

    // Server-update timer: every 3 s — uses cached position from stream
    _locationTimer = Timer.periodic(const Duration(seconds: 3), (_) async {
      final pos = _lastTripPosition;
      if (pos == null || !mounted) return;
      _socket.sendLocation(
          lat: pos.latitude,
          lng: pos.longitude,
          heading: pos.heading,
          speed: pos.speed);
      final locHeaders = await AuthService.getHeaders();
      http
          .post(Uri.parse(ApiConfig.driverLocation),
              headers: {...locHeaders, 'Content-Type': 'application/json'},
              body: jsonEncode({
                'lat': pos.latitude,
                'lng': pos.longitude,
                'isOnline': true
              }))
          .catchError((_) => http.Response('', 500));
    });
  }

  void _computeDistanceAndEta(double lat, double lng) {
    if (_trip == null) return;
    final toPickup = _status == 'accepted' || _status == 'driver_assigned';
    if (lat == 0 && lng == 0) return; // Ignore invalid coordinates
    final tLat = toPickup
        ? double.tryParse(_trip!['pickupLat']?.toString() ?? _trip!['pickup_lat']?.toString() ?? '') ?? 0.0
        : double.tryParse(_trip!['destinationLat']?.toString() ?? _trip!['destination_lat']?.toString() ?? '') ?? 0.0;
    final tLng = toPickup
        ? double.tryParse(_trip!['pickupLng']?.toString() ?? _trip!['pickup_lng']?.toString() ?? '') ?? 0.0
        : double.tryParse(_trip!['destinationLng']?.toString() ?? _trip!['destination_lng']?.toString() ?? '') ?? 0.0;
    if (tLat == 0 && tLng == 0) return;
    final dm = Geolocator.distanceBetween(lat, lng, tLat, tLng);
    final etaS = dm > 0 ? (dm / 8.33).round() : 0;
    if (mounted)
      setState(() {
        _distanceToTargetM = dm;
        _etaSec = etaS;
      });
    if (toPickup) {
      final near = dm <= 100;
      if (mounted && near != _nearPickup) {
        setState(() => _nearPickup = near);
        if (near) _showSnack('You are near the pickup location!');
      }
    } else {
      if (dm <= 300) {
        _speakCue(
          'You are nearing the destination. Follow the highlighted route.',
          dedupeKey: 'near_destination',
        );
      }
    }
  }

  // ── Cancel reasons ────────────────────────────────────────────────────────

  Future<void> _loadCancelReasons() async {
    try {
      final res = await http.get(Uri.parse(ApiConfig.configs)).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final reasons = (data['cancellationReasons'] as List<dynamic>? ?? [])
            .where(
                (r) => r['userType'] == 'driver' || r['user_type'] == 'driver')
            .map((r) => r['reason']?.toString() ?? '')
            .where((r) => r.isNotEmpty)
            .toList();
        if (mounted) setState(() => _cancelReasons = reasons);
      }
    } catch (_) {}
  }

  // ── Trip actions ──────────────────────────────────────────────────────────

  Future<void> _nextStep() async {
    if (_loading) return;
    if (_status == 'arrived') {
      _showOtpBottomSheet();
      return;
    }
    if (_status != 'accepted' &&
        _status != 'driver_assigned' &&
        _status != 'in_progress' &&
        _status != 'on_the_way') {
      _showSnack('Invalid trip status for this action', error: true);
      return;
    }
    setState(() => _loading = true);
    final h = await AuthService.getHeaders();
    final tripId = (_trip?['id'] ?? _trip?['tripId'] ?? '').toString();
    if (tripId.isEmpty) {
      _showSnack('Trip ID missing', error: true);
      setState(() => _loading = false);
      return;
    }

    try {
      if (_status == 'accepted' || _status == 'driver_assigned') {
        final pos = _lastTripPosition;
        if (!_nearPickup) {
          _showSnack('Move within 100m of pickup before marking arrived.', error: true);
          setState(() => _loading = false);
          return;
        }
        final body = await TripService.markArrived(
          tripId,
          lat: pos?.latitude,
          lng: pos?.longitude,
        );
        if (!mounted) return;
        if (body['success'] == true ||
            (body['trip'] != null && body['idempotent'] == true)) {
          setState(() {
            _status = 'arrived';
            _trip = _mergeTripState(
              _trip,
              body['trip'] is Map<String, dynamic>
                  ? body['trip'] as Map<String, dynamic>
                  : null,
            );
            _loading = false;
          });
          debugPrint('[TRIP] ✅ Arrived at pickup — tripId=$tripId');
          _showSnack('Arrived! Ask customer for OTP 📍');
          // Pre-fetch route to destination while driver waits for OTP
          // (polylines will be ready the moment trip starts)
          await _refreshTripFromServer();
          // Actually we want destination route pre-loaded, fetch it explicitly
          final t = _trip;
          if (t != null) {
            final dLat = double.tryParse(t['destinationLat']?.toString() ?? t['destination_lat']?.toString() ?? '') ?? 0.0;
            final dLng = double.tryParse(t['destinationLng']?.toString() ?? t['destination_lng']?.toString() ?? '') ?? 0.0;
            final origin = _lastTripPosition;
            final fromLat = origin?.latitude ?? _center.latitude;
            final fromLng = origin?.longitude ?? _center.longitude;
            if (dLat != 0 && dLng != 0) {
              await _fetchRoute(fromLat, fromLng, dLat, dLng);
            }
          }
        } else {
          await _refreshTripFromServer(openOtpIfArrived: true);
          if (_status == 'arrived') {
            setState(() => _loading = false);
            return;
          }
          final code = (body['code'] ?? '').toString();
          _showSnack(
            _arrivedErrorMessage(
              code,
              body['message']?.toString() ?? body['error']?.toString(),
            ),
            error: code != 'TRIP_ALREADY_STARTED',
          );
          setState(() => _loading = false);
        }
      } else if (_status == 'in_progress' || _status == 'on_the_way') {
        await _completeTrip(h);
        return;
      }
    } on TimeoutException {
      if (!mounted) return;
      await _refreshTripFromServer(openOtpIfArrived: true);
      if (_status != 'arrived') {
        _showSnack(
            'Unable to update trip status. Checking latest trip state...',
            error: true);
      }
      setState(() => _loading = false);
    } catch (_) {
      if (!mounted) return;
      await _refreshTripFromServer(openOtpIfArrived: true);
      if (_status != 'arrived') {
        _showSnack('Network issue while updating arrival. Retrying sync...',
            error: true);
      }
      setState(() => _loading = false);
    }
  }

  String _arrivedErrorMessage(String code, String? fallback) {
    switch (code) {
      case 'TRIP_ALREADY_STARTED':
        return 'Ride already started on server. Syncing latest trip state...';
      case 'TRIP_OWNERSHIP_MISMATCH':
        return 'This trip is already assigned to another driver.';
      case 'TRIP_CANCELLED':
        return 'Trip was cancelled by customer.';
      case 'TOO_FAR_FROM_PICKUP':
        return 'Move closer to the pickup point, then slide to mark arrived.';
      case 'TRIP_ALREADY_COMPLETED':
        return 'Trip already completed.';
      case 'TRIP_NOT_FOUND':
        return 'Trip not found. Refreshing latest trip state...';
      case 'INVALID_TRIP_STATUS':
        return fallback?.isNotEmpty == true
            ? fallback!
            : 'Trip status changed. Refreshing latest trip state...';
      default:
        return fallback?.isNotEmpty == true
            ? fallback!
            : 'Unable to update trip status. Checking latest trip state...';
    }
  }

  Future<void> _completeTrip(Map<String, String> authHeaders) async {
    final tripId = _trip?['id'] ?? _trip?['tripId'] ?? '';
    final estFare = _trip?['estimatedFare'] ?? _trip?['estimated_fare'] ?? 0.0;
    final estDist =
        _trip?['estimatedDistance'] ?? _trip?['estimated_distance'] ?? 0.0;
    try {
      final res = await apiRetry(() => http.post(Uri.parse(ApiConfig.driverCompleteTrip),
          headers: {...authHeaders, 'Content-Type': 'application/json'},
          body: jsonEncode({
            'tripId': tripId,
            'actualFare': estFare,
            'actualDistance': estDist
          })).timeout(const Duration(seconds: 10)));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final pricing = data['pricing'] as Map<String, dynamic>? ?? {};
        final rideFare = pricing['rideFare'] ??
            data['trip']?['actualFare'] ??
            data['trip']?['actual_fare'] ??
            estFare;
        final driverEarnings = pricing['driverWalletCredit'] ?? rideFare;
        final commission = pricing['platformDeduction'] ?? 0;
        _socket.setActiveTrip(null); // clear trip room tracking
        _locationTimer?.cancel();
        _posStream?.cancel();
        _stopTripTimer();
        debugPrint(
            '[TRIP] ✅ Ride completed — tripId=$tripId fare=$rideFare earnings=$driverEarnings');
        if (!mounted) return;
        _showCompletionSheet(
          rideFare.toString(),
          driverEarnings: driverEarnings.toString(),
          commission: commission.toString(),
        );
      } else {
        String errMsg = 'Error completing trip';
        try {
          errMsg = (jsonDecode(res.body) as Map)['message'] ?? errMsg;
        } catch (_) {}
        if (!mounted) return;
        _showSnack(errMsg, error: true);
        setState(() => _loading = false);
      }
    } catch (e) {
      debugPrint('[TRIP] ❌ complete-trip network error: $e');
      if (!mounted) return;
      _showSnack('Network error. Please tap "Complete" again.', error: true);
      setState(() => _loading = false);
    }
  }

  Future<void> _cancelTrip(String reason) async {
    setState(() => _loading = true);
    final cancelHeaders = await AuthService.getHeaders();
    final tripId = _trip?['id'] ?? _trip?['tripId'] ?? '';
    try {
      await http.post(Uri.parse(ApiConfig.driverCancelTrip),
          headers: {...cancelHeaders, 'Content-Type': 'application/json'},
          body: jsonEncode({'tripId': tripId, 'reason': reason})).timeout(const Duration(seconds: 10));
    } catch (_) {}
    _socket.setActiveTrip(null); // clear trip room tracking
    _locationTimer?.cancel();
    _posStream?.cancel();
    _posStream = null;
    _stopTripTimer();
    _stopStatePoll();
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(context,
        MaterialPageRoute(builder: (_) => const HomeScreen()), (_) => false);
  }

  // ── OTP ───────────────────────────────────────────────────────────────────

  void _showOtpBottomSheet() {
    _otpCtrl.clear();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                    color: JT.border, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 20),
            Row(children: [
              Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                      color: JT.primary.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(16)),
                  child: const Icon(Icons.lock_open_rounded,
                      color: JT.primary, size: 28)),
              const SizedBox(width: 14),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text('Enter Customer OTP',
                        style: GoogleFonts.poppins(
                            color: JT.textPrimary,
                            fontWeight: FontWeight.w400,
                            fontSize: 18)),
                    Text('Ask customer for OTP shown in JAGO Pro app',
                        style: GoogleFonts.poppins(
                            color: JT.textSecondary, fontSize: 12)),
                  ])),
            ]),
            const SizedBox(height: 24),
            Container(
              decoration: BoxDecoration(
                color: JT.bgSoft,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                    color: JT.primary.withValues(alpha: 0.3), width: 1.5),
              ),
              child: TextField(
                controller: _otpCtrl,
                keyboardType: TextInputType.number,
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                textAlign: TextAlign.center,
                autofocus: true,
                style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontSize: 32,
                    fontWeight: FontWeight.w500,
                    letterSpacing: 12),
                decoration: InputDecoration(
                  counterText: '',
                  hintText: '——————',
                  hintStyle: GoogleFonts.poppins(
                      color: JT.iconInactive, letterSpacing: 8, fontSize: 24),
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 18),
                ),
              ),
            ),
            const SizedBox(height: 20),
            Row(children: [
              Expanded(
                  child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        foregroundColor: JT.textSecondary,
                        side: BorderSide(color: JT.border),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                        padding: const EdgeInsets.symmetric(vertical: 16),
                      ),
                      onPressed: () => Navigator.pop(ctx),
                      child: Text('Cancel',
                          style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w400)))),
              const SizedBox(width: 12),
              Expanded(
                  flex: 2,
                  child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                          backgroundColor: JT.primary,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14)),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          elevation: 0),
                      onPressed: () async {
                        final otp = _otpCtrl.text.trim();
                        if (otp.length < 4) return;
                        Navigator.pop(ctx);
                        await _verifyOtpAndStart(otp);
                      },
                      child: Text('Verify & Start Trip →',
                          style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w400, fontSize: 14)))),
            ]),
            const SizedBox(height: 16),
            TextButton(
                onPressed: () {
                  Navigator.pop(ctx);
                  _showCancelDialog();
                },
                child: Text('Trouble with OTP? Cancel Trip',
                    style: GoogleFonts.poppins(
                        color: JT.error,
                        fontSize: 12,
                        fontWeight: FontWeight.w400))),
          ]),
        ),
      ),
    );
  }

  Future<void> _verifyOtpAndStart(String otp) async {
    setState(() => _loading = true);
    final h = await AuthService.getHeaders();
    final tripId = _trip?['id'] ?? _trip?['tripId'] ?? '';
    try {
      final res = await http.post(Uri.parse(ApiConfig.driverVerifyOtp),
          headers: {...h, 'Content-Type': 'application/json'},
          body: jsonEncode({'tripId': tripId, 'otp': otp})).timeout(const Duration(seconds: 10));
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final serverTrip = body['trip'] is Map<String, dynamic>
          ? body['trip'] as Map<String, dynamic>
          : null;
      if (res.statusCode == 200) {
        debugPrint('[TRIP] ✅ OTP verified — trip started — tripId=$tripId');
        if (!mounted) return;
        setState(() {
          _trip = _mergeTripState(_trip, serverTrip);
          _status = (serverTrip?['currentStatus'] ??
                  serverTrip?['current_status'] ??
                  'on_the_way')
              .toString();
          _loading = false;
        });
        _startTripTimer();

        await _focusRouteOnMap(showReadySnack: true);
        _announceStatusCue(_status);
        _showSnack('Trip started! Destination route is live inside the app');
        _showPickupPhotoPrompt(tripId);
      } else {
        final err = jsonDecode(res.body);
        if (!mounted) return;
        _showSnack(err['message'] ?? 'Wrong OTP', error: true);
        setState(() => _loading = false);
      }
    } catch (_) {
      if (!mounted) return;
      _showSnack('Network error. Try again.', error: true);
      setState(() => _loading = false);
    }
  }

  // ── Pickup photo ──────────────────────────────────────────────────────────

  void _showPickupPhotoPrompt(String tripId) {
    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: JT.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                  color: JT.border, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 20),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
                color: JT.surfaceAlt,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: JT.border)),
            child: Row(children: [
              Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                      color: JT.primary.withValues(alpha: 0.10),
                      shape: BoxShape.circle),
                  child: const Icon(Icons.camera_alt_rounded,
                      color: JT.primary, size: 26)),
              const SizedBox(width: 14),
              Expanded(
                  child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Text('Pickup Photo',
                        style: GoogleFonts.poppins(
                            color: JT.textPrimary,
                            fontWeight: FontWeight.w400,
                            fontSize: 15)),
                    Text('Capture for ride security',
                        style: GoogleFonts.poppins(
                            color: JT.textSecondary, fontSize: 12)),
                  ])),
            ]),
          ),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(
                child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                        foregroundColor: JT.textSecondary,
                        side: BorderSide(color: JT.border),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                        padding: const EdgeInsets.symmetric(vertical: 14)),
                    onPressed: () => Navigator.pop(context),
                    child: Text('Skip',
                        style:
                            GoogleFonts.poppins(fontWeight: FontWeight.w400)))),
            const SizedBox(width: 12),
            Expanded(
                flex: 2,
                child: ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                        backgroundColor: JT.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        elevation: 0),
                    icon: const Icon(Icons.camera_alt_rounded, size: 18),
                    label: Text('Take Photo',
                        style:
                            GoogleFonts.poppins(fontWeight: FontWeight.w400)),
                    onPressed: () {
                      Navigator.pop(context);
                      _captureAndUploadPhoto(tripId);
                    })),
          ]),
        ]),
      ),
    );
  }

  Future<void> _captureAndUploadPhoto(String tripId) async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
          source: ImageSource.camera, imageQuality: 70, maxWidth: 1280);
      if (picked == null || !mounted) return;
      _showSnack('Uploading photo…');
      final ph = await AuthService.getHeaders();
      final req = http.MultipartRequest('POST', Uri.parse(ApiConfig.tripPhoto));
      req.headers.addAll(ph);
      req.fields['tripId'] = tripId;
      req.files.add(await http.MultipartFile.fromPath('photo', picked.path));
      final resp = await req.send();
      if (!mounted) return;
      _showSnack(
          resp.statusCode == 200 ? 'Photo saved ✓' : 'Photo upload failed',
          error: resp.statusCode != 200);
    } catch (_) {
      if (mounted) _showSnack('Photo upload failed', error: true);
    }
  }

  // ── Completion sheet ──────────────────────────────────────────────────────

  void _showCompletionSheet(String fare,
      {String driverEarnings = '0', String commission = '0'}) {
    int selectedRating = 0;
    bool ratingSubmitted = false;
    final tripId = _trip?['id'] ?? _trip?['tripId'] ?? '';
    final pm = _trip?['paymentMethod'] ?? _trip?['payment_method'] ?? 'cash';
    final isCash = pm == 'cash';
    final netEarnings = double.tryParse(driverEarnings) ?? 0.0;
    final commissionAmt = double.tryParse(commission) ?? 0.0;
    final fullFare = double.tryParse(fare) ?? 0.0;
    final elapsed = _formatElapsed(_tripElapsedSec);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      isDismissible: false,
      enableDrag: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
          ),
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
          child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                    color: JT.border, borderRadius: BorderRadius.circular(2))),
            const SizedBox(height: 20),
            // Success icon
            Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                    color: JT.success.withValues(alpha: 0.10),
                    shape: BoxShape.circle,
                    border: Border.all(
                        color: JT.success.withValues(alpha: 0.3), width: 2)),
                child: const Icon(Icons.check_rounded,
                    color: JT.success, size: 44)),
            const SizedBox(height: 16),
            Text('Trip Complete!',
                style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.w500)),
            const SizedBox(height: 4),
            Text('Great job! Ride completed successfully.',
                style:
                    GoogleFonts.poppins(color: JT.textSecondary, fontSize: 13)),
            const SizedBox(height: 20),
            // Earnings card
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                    colors: [JT.primary, JT.primary.withValues(alpha: 0.75)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight),
                borderRadius: BorderRadius.circular(20),
                boxShadow: JT.btnShadow,
              ),
              child: Column(children: [
                Text('YOUR EARNINGS',
                    style: GoogleFonts.poppins(
                        color: Colors.white70,
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        letterSpacing: 1.5)),
                const SizedBox(height: 6),
                Text('₹${netEarnings.toStringAsFixed(0)}',
                    style: GoogleFonts.poppins(
                        color: Colors.white,
                        fontSize: 48,
                        fontWeight: FontWeight.w500,
                        height: 1.1)),
                const SizedBox(height: 12),
                Container(height: 1, color: Colors.white24),
                const SizedBox(height: 12),
                Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      _completionStat(
                          'Fare', '₹${fullFare.toStringAsFixed(0)}'),
                      _completionStat(
                          'Commission', '₹${commissionAmt.toStringAsFixed(0)}'),
                      _completionStat('Duration', elapsed),
                    ]),
              ]),
            ),
            const SizedBox(height: 14),
            // Payment instruction
            if (isCash)
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: const Color(0xFFF0FDF4),
                    borderRadius: BorderRadius.circular(16),
                    border:
                        Border.all(color: JT.success.withValues(alpha: 0.35))),
                child: Row(children: [
                  Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                          color: JT.success.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(12)),
                      child: const Icon(Icons.payments_rounded,
                          color: JT.success, size: 24)),
                  const SizedBox(width: 14),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text('Collect ₹${fullFare.toStringAsFixed(0)} Cash',
                            style: GoogleFonts.poppins(
                                color: JT.success,
                                fontWeight: FontWeight.w400,
                                fontSize: 15)),
                        Text(
                            'Platform fee ₹${commissionAmt.toStringAsFixed(0)} deducted from your wallet',
                            style: GoogleFonts.poppins(
                                color: JT.textSecondary, fontSize: 11)),
                      ])),
                ]),
              )
            else
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                    color: JT.primary.withValues(alpha: 0.05),
                    borderRadius: BorderRadius.circular(16),
                    border:
                        Border.all(color: JT.primary.withValues(alpha: 0.2))),
                child: Row(children: [
                  const Icon(Icons.account_balance_wallet_rounded,
                      color: JT.primary, size: 24),
                  const SizedBox(width: 14),
                  Expanded(
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                        Text(
                            '₹${netEarnings.toStringAsFixed(0)} added to wallet',
                            style: GoogleFonts.poppins(
                                color: JT.primary,
                                fontWeight: FontWeight.w400,
                                fontSize: 15)),
                        Text(
                            pm == 'wallet'
                                ? 'Customer wallet deducted'
                                : 'Customer paid online',
                            style: GoogleFonts.poppins(
                                color: JT.textSecondary, fontSize: 11)),
                      ])),
                ]),
              ),
            const SizedBox(height: 14),
            // Rating
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                  color: JT.bgSoft,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: JT.border)),
              child: ratingSubmitted
                  ? Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                      const Icon(Icons.star_rounded,
                          color: Colors.amber, size: 22),
                      const SizedBox(width: 8),
                      Text('Thank you for rating!',
                          style: GoogleFonts.poppins(
                              color: JT.textSecondary,
                              fontWeight: FontWeight.w400)),
                    ])
                  : Column(children: [
                      Text('Rate this customer',
                          style: GoogleFonts.poppins(
                              color: JT.textPrimary,
                              fontSize: 14,
                              fontWeight: FontWeight.w500)),
                      const SizedBox(height: 10),
                      Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            for (int i = 1; i <= 5; i++)
                              GestureDetector(
                                onTap: () async {
                                  setS(() => selectedRating = i);
                                  final rh = await AuthService.getHeaders();
                                  // FIX: this used to swallow any failure (network error, 500,
                                  // or 409 "already rated") and unconditionally show "Thank you
                                  // for rating!" regardless of whether the rating actually saved.
                                  // Only a genuine success (200) or an already-submitted rating
                                  // (409, harmless to treat as done) marks it complete; anything
                                  // else surfaces an error so the driver can retry.
                                  try {
                                    final r = await http.post(
                                        Uri.parse(ApiConfig.driverRateCustomer),
                                        headers: {
                                          ...rh,
                                          'Content-Type': 'application/json'
                                        },
                                        body: jsonEncode(
                                            {'tripId': tripId, 'rating': i})).timeout(const Duration(seconds: 10));
                                    if (r.statusCode == 200 || r.statusCode == 409) {
                                      setS(() => ratingSubmitted = true);
                                    } else {
                                      _showSnack('Could not submit rating. Please try again.', error: true);
                                    }
                                  } catch (_) {
                                    _showSnack('Network error. Please try again.', error: true);
                                  }
                                },
                                child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 6),
                                    child: Icon(
                                        i <= selectedRating
                                            ? Icons.star_rounded
                                            : Icons.star_border_rounded,
                                        color: Colors.amber,
                                        size: 40)),
                              ),
                          ]),
                    ]),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 56,
              child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                      backgroundColor: JT.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16)),
                      elevation: 0),
                  onPressed: () {
                    Navigator.pop(ctx);
                    Navigator.pushAndRemoveUntil(
                        context,
                        MaterialPageRoute(builder: (_) => const HomeScreen()),
                        (_) => false);
                  },
                  child: Text('Back to Home →',
                      style: GoogleFonts.poppins(
                          fontWeight: FontWeight.w400, fontSize: 16))),
            ),
          ])),
        ),
      ),
    );
  }

  Widget _completionStat(String label, String value) {
    return Column(children: [
      Text(value,
          style: GoogleFonts.poppins(
              color: Colors.white, fontWeight: FontWeight.w400, fontSize: 15)),
      Text(label,
          style: GoogleFonts.poppins(
              color: Colors.white60,
              fontSize: 10,
              fontWeight: FontWeight.w400)),
    ]);
  }

  // ── Cancel dialog ─────────────────────────────────────────────────────────

  void _showCancelDialog() {
    final reasons = _cancelReasons.isNotEmpty
        ? _cancelReasons
        : [
            'Customer not at pickup location',
            'Customer is not responding',
            'Vehicle breakdown',
            'Customer requested to cancel',
            'Other reason',
          ];
    showModalBottomSheet(
      context: context,
      backgroundColor: JT.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                  color: JT.border, borderRadius: BorderRadius.circular(2))),
          const SizedBox(height: 16),
          Row(children: [
            Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                    color: JT.error.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(10)),
                child: const Icon(Icons.cancel_rounded,
                    color: JT.error, size: 20)),
            const SizedBox(width: 12),
            Text('Cancel Reason',
                style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontSize: 17,
                    fontWeight: FontWeight.w400)),
          ]),
          const SizedBox(height: 12),
          ...reasons.map((r) => ListTile(
              title: Text(r,
                  style:
                      GoogleFonts.poppins(color: JT.textPrimary, fontSize: 13)),
              leading: const Icon(Icons.chevron_right_rounded,
                  color: JT.iconInactive, size: 18),
              contentPadding: EdgeInsets.zero,
              dense: true,
              onTap: () {
                Navigator.pop(context);
                _cancelTrip(r);
              })),
          const SizedBox(height: 8),
        ]),
      ),
    );
  }

  // ── Delivery OTP ──────────────────────────────────────────────────────────

  void _showDeliveryOtpDialog() {
    final ctrl = TextEditingController();
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => Dialog(
        backgroundColor: JT.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                    color: JT.warning.withValues(alpha: 0.10),
                    shape: BoxShape.circle),
                child: const Icon(Icons.local_shipping_rounded,
                    color: JT.warning, size: 32)),
            const SizedBox(height: 16),
            Text('Delivery OTP',
                style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontWeight: FontWeight.w400,
                    fontSize: 18)),
            const SizedBox(height: 4),
            Text('Ask receiver for OTP to confirm delivery',
                style:
                    GoogleFonts.poppins(color: JT.textSecondary, fontSize: 13),
                textAlign: TextAlign.center),
            const SizedBox(height: 20),
            Container(
                decoration: BoxDecoration(
                    color: JT.bgSoft,
                    borderRadius: BorderRadius.circular(14),
                    border:
                        Border.all(color: JT.warning.withValues(alpha: 0.3))),
                child: TextField(
                  controller: ctrl,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  textAlign: TextAlign.center,
                  style: GoogleFonts.poppins(
                      color: JT.textPrimary,
                      fontSize: 28,
                      fontWeight: FontWeight.w500,
                      letterSpacing: 10),
                  decoration: InputDecoration(
                      counterText: '',
                      hintText: '------',
                      hintStyle: GoogleFonts.poppins(
                          color: JT.iconInactive,
                          letterSpacing: 10,
                          fontSize: 24),
                      border: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 16)),
                )),
            const SizedBox(height: 20),
            Row(children: [
              Expanded(
                  child: TextButton(
                      onPressed: () => Navigator.pop(ctx),
                      style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12))),
                      child: Text('Cancel',
                          style: GoogleFonts.poppins(
                              color: JT.textSecondary,
                              fontWeight: FontWeight.w400)))),
              const SizedBox(width: 12),
              Expanded(
                  child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                          backgroundColor: JT.warning,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          elevation: 0),
                      onPressed: () async {
                        final otp = ctrl.text.trim();
                        if (otp.isEmpty) return;
                        Navigator.pop(ctx);
                        await _verifyDeliveryOtp(otp);
                      },
                      child: Text('Verify ✓',
                          style: GoogleFonts.poppins(
                              fontWeight: FontWeight.w400)))),
            ]),
          ]),
        ),
      ),
    ).then((_) => ctrl.dispose());
  }

  Future<void> _verifyDeliveryOtp(String otp) async {
    if (!mounted) return;
    setState(() => _loading = true);
    final h = await AuthService.getHeaders();
    final tripId = _trip?['id'] ?? _trip?['tripId'] ?? '';
    try {
      final res = await http.post(Uri.parse(ApiConfig.verifyDeliveryOtp),
          headers: {...h, 'Content-Type': 'application/json'},
          body: jsonEncode({'tripId': tripId, 'otp': otp})).timeout(const Duration(seconds: 10));
      if (!mounted) return;
      _showSnack(
          res.statusCode == 200
              ? 'Delivery verified! ✓'
              : (jsonDecode(res.body)['message'] ?? 'Wrong OTP'),
          error: res.statusCode != 200);
    } catch (_) {
      if (!mounted) return;
      _showSnack('Network error', error: true);
    }
    if (mounted) setState(() => _loading = false);
  }

  // ── Call / Navigation / SOS ───────────────────────────────────────────────

  void _startInAppCall(String contactName) {
    final customerId =
        _trip?['customerId']?.toString() ?? _trip?['customer_id']?.toString();
    final tripId =
        _trip?['id']?.toString() ?? _trip?['tripId']?.toString() ?? '';
    if (customerId == null || customerId.isEmpty) return;
    Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => CallScreen(
            contactName: contactName,
            tripId: tripId,
            targetUserId: customerId)));
  }

  void _openTripChat() {
    final tripId =
        _trip?['id']?.toString() ?? _trip?['tripId']?.toString() ?? '';
    showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (_) => TripChatSheet(tripId: tripId, senderName: 'Driver'));
  }

  Future<void> _openNavigation() async {
    final tLat = _isHeadingToPickup
        ? _resolveCoord(['pickupLat', 'pickup_lat'])
        : _resolveCoord(['destinationLat', 'destination_lat']);
    final tLng = _isHeadingToPickup
        ? _resolveCoord(['pickupLng', 'pickup_lng'])
        : _resolveCoord(['destinationLng', 'destination_lng']);
    final label = _resolveTargetLabel();

    if (tLat != 0 && tLng != 0) {
      await _focusRouteOnMap(showReadySnack: true);
      if (_mapController != null) {
        return;
      }
    }
    final uri = tLat != 0 && tLng != 0
        ? Uri.parse(
            'https://www.google.com/maps/dir/?api=1&destination=$tLat,$tLng&travelmode=driving')
        : Uri.parse(
            'https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(label)}');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      _showSnack('Cannot open navigation', error: true);
    }
  }

  Future<void> _triggerSos() async {
    final confirm = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
                backgroundColor: JT.surface,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(20)),
                title: Text('SOS Alert',
                    style: GoogleFonts.poppins(
                        color: JT.textPrimary, fontWeight: FontWeight.w500)),
                content: Text(
                    'Emergency SOS send చేయాలా? Help team contact అవుతారు.',
                    style: GoogleFonts.poppins(color: JT.textSecondary)),
                actions: [
                  TextButton(
                      onPressed: () => Navigator.pop(context, false),
                      child: Text('Cancel',
                          style: GoogleFonts.poppins(color: JT.textSecondary))),
                  ElevatedButton(
                      style:
                          ElevatedButton.styleFrom(backgroundColor: JT.error),
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('SOS పంపు',
                          style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w500))),
                ]));
    if (confirm != true) return;
    final h = await AuthService.getHeaders();
    final tripId = _trip?['id'] ?? _trip?['tripId'] ?? '';
    try {
      await http.post(Uri.parse(ApiConfig.sos),
          headers: {...h, 'Content-Type': 'application/json'},
          body: jsonEncode({
            'tripId': tripId,
            'lat': _center.latitude,
            'lng': _center.longitude,
            'message': 'Driver SOS alert during trip'
          })).timeout(const Duration(seconds: 10));
      if (!mounted) return;
      _showSnack('SOS Alert sent! Help is on the way.');
    } catch (_) {
      if (!mounted) return;
      _showSnack('SOS send failed. Call 100 immediately!', error: true);
    }
  }

  void _showSnack(String msg, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg,
          style: const TextStyle(
              fontWeight: FontWeight.w400, color: Colors.white)),
      backgroundColor: error ? JT.error : JT.primary,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final customerName =
        _trip?['customerName'] ?? _trip?['customer_name'] ?? 'Customer';
    final customerPhone = _trip?['customerPhone'] ?? _trip?['customer_phone'];
    final pickup = _shortLocation((_trip?['pickupShortName'] ??
            _trip?['pickupAddress'] ??
            _trip?['pickup_address'] ??
            'Pickup')
        .toString());
    final dest = _shortLocation((_trip?['destinationShortName'] ??
            _trip?['destinationAddress'] ??
            _trip?['destination_address'] ??
            'Destination')
        .toString());
    final isParcel = (_trip?['type'] ?? _trip?['tripType'] ?? '')
            .toString()
            .toLowerCase()
            .contains('parcel') ||
        (_trip?['notes']?.toString().startsWith('📦') ?? false);
    final isForSomeoneElse = _trip?['isForSomeoneElse'] == true ||
        _trip?['is_for_someone_else'] == true;
    final passengerName =
        _trip?['passengerName'] ?? _trip?['passenger_name'] ?? '';
    final passengerPhone =
        _trip?['passengerPhone'] ?? _trip?['passenger_phone'];
    final bottomOverlayOffset = _isTripLive
        ? 500.0
        : _isAtPickup
            ? 380.0
            : 350.0;

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: JT.bg,
        body: Stack(children: [
          // ── Full screen map ────────────────────────────────────────────────
          Positioned.fill(
            child: GoogleMap(
              initialCameraPosition: CameraPosition(target: _center, zoom: 15),
              onMapCreated: (c) {
                _mapController = c;
                c.animateCamera(CameraUpdate.newLatLng(_center));
                _initMapMarkers();
              },
              markers: _markers,
              polylines: _polylines,
              myLocationEnabled: true,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              mapToolbarEnabled: false,
              compassEnabled: false,
              padding:
                  EdgeInsets.only(bottom: bottomOverlayOffset + 80, top: 86),
            ),
          ),

          // ── Top status bar ─────────────────────────────────────────────────
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: _buildTopBar(pickup, dest),
            ),
          ),

          // ── Bottom action sheet ────────────────────────────────────────────
          Positioned(
            left: 16,
            bottom: bottomOverlayOffset,
            child: _buildSpeedBubble(),
          ),
          Positioned(
            right: 16,
            bottom: bottomOverlayOffset - 18,
            child: _buildMapControls(),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: bottomOverlayOffset - 18,
            child: Center(child: _buildNavigationInstructions()),
          ),

          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(28)),
                boxShadow: [
                  BoxShadow(
                      color: Colors.black.withValues(alpha: 0.10),
                      blurRadius: 24)
                ],
              ),
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Container(
                    width: 44,
                    height: 4,
                    margin: const EdgeInsets.only(top: 10, bottom: 4),
                    decoration: BoxDecoration(
                        color: JT.border,
                        borderRadius: BorderRadius.circular(2))),
                SafeArea(
                  top: false,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: MediaQuery.of(context).size.height *
                          (_isTripLive ? 0.58 : 0.46),
                    ),
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
                      child: Column(mainAxisSize: MainAxisSize.min, children: [
                    _buildStageStrip(),
                    if (_isAtPickup) ...[
                      const SizedBox(height: 10),
                      _buildWaitTimerCard(),
                    ],
                    if (_isTripLive) ...[
                      const SizedBox(height: 10),
                      _buildRouteStageCard(pickup, dest),
                    ],
                    const SizedBox(height: 10),
                    _buildCustomerCard(customerName, customerPhone),
                    if (isForSomeoneElse &&
                        passengerName.toString().isNotEmpty) ...[
                      const SizedBox(height: 8),
                      _buildPassengerCard(
                          passengerName.toString(), passengerPhone?.toString()),
                    ],
                    if (isParcel && _trip?['notes'] != null) ...[
                      const SizedBox(height: 8),
                      _buildParcelCard(_trip!['notes'].toString()),
                    ],
                    const SizedBox(height: 10),
                    _buildLiveStats(),
                    const SizedBox(height: 8),
                    _buildPaymentBadge(),
                    if ((_status == 'in_progress' || _status == 'on_the_way') &&
                        isParcel) ...[
                      const SizedBox(height: 6),
                      _buildDeliveryOtpBtn(),
                    ],
                    _buildActionBtn(),
                    const SizedBox(height: 8),
                    _buildQuickActions(customerPhone?.toString()),
                  ]),
                    ),
                  ),
                ),
              ]),
            ),
          ),
        ]),
      ),
    );
  }

  // ── Top bar ───────────────────────────────────────────────────────────────

  Widget _buildSpeedBubble() {
    final speed = _currentSpeedKmph.round().clamp(0, 160);
    return Container(
      width: 72,
      height: 72,
      decoration: BoxDecoration(
        color: const Color(0xFFFFC400),
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.18),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text('$speed',
            style: GoogleFonts.poppins(
                color: Colors.black,
                fontSize: 24,
                fontWeight: FontWeight.w700,
                height: 1)),
        Text('km/h',
            style: GoogleFonts.poppins(
                color: Colors.black,
                fontSize: 11,
                fontWeight: FontWeight.w600)),
      ]),
    );
  }

  Widget _buildMapControls() {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      _mapControlButton(
        icon: Icons.my_location_rounded,
        color: JT.primary,
        onTap: _centerDriverOnMap,
      ),
      const SizedBox(height: 12),
      _mapControlButton(
        icon: Icons.sos_rounded,
        color: JT.error,
        onTap: _triggerSos,
      ),
    ]);
  }

  Widget _mapControlButton({
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.14),
              blurRadius: 14,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Icon(icon, color: color, size: 26),
      ),
    );
  }

  void _centerDriverOnMap() {
    final pos = _lastTripPosition;
    if (pos == null || _mapController == null) {
      _focusRouteOnMap(showReadySnack: true);
      return;
    }
    _mapController!.animateCamera(
      CameraUpdate.newLatLngZoom(LatLng(pos.latitude, pos.longitude), 17),
    );
  }

  Widget _buildStageStrip() {
    final Color color = _isTripLive
        ? JT.success
        : _isAtPickup
            ? JT.success
            : JT.primary;
    final String title = _isTripLive
        ? 'Trip in Progress'
        : _isAtPickup
            ? 'Customer Verified Location'
            : 'Customer Verified Location';
    final String subtitle = _isTripLive
        ? _resolveTargetAddress()
        : _isAtPickup
            ? 'Ask customer for OTP to start the ride.'
            : _resolveTargetAddress();

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          child: Icon(
            _isTripLive ? Icons.speed_rounded : Icons.verified_rounded,
            color: color,
            size: 20,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child:
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title,
                style: GoogleFonts.poppins(
                    color: color,
                    fontSize: 14,
                    fontWeight: FontWeight.w700)),
            if (subtitle.trim().isNotEmpty)
              Text(subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(
                      color: JT.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w500)),
          ]),
        ),
        if (_isTripLive)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.circle, color: JT.success, size: 8),
              const SizedBox(width: 5),
              Text('LIVE',
                  style: GoogleFonts.poppins(
                      color: color,
                      fontSize: 10,
                      fontWeight: FontWeight.w700)),
            ]),
          ),
      ]),
    );
  }

  Widget _buildWaitTimerCard() {
    final arrivedAtRaw =
        _trip?['arrivedAt']?.toString() ?? _trip?['arrived_at']?.toString();
    final arrivedAt =
        arrivedAtRaw == null ? null : DateTime.tryParse(arrivedAtRaw);
    final elapsedSeconds = arrivedAt == null
        ? 0
        : DateTime.now().difference(arrivedAt).inSeconds.clamp(0, 9999);
    final minutes = (elapsedSeconds ~/ 60).toString().padLeft(2, '0');
    final seconds = (elapsedSeconds % 60).toString().padLeft(2, '0');

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.primary.withValues(alpha: 0.14)),
      ),
      child: Row(children: [
        Expanded(
          child: Column(children: [
            Text('Wait Timer',
                style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontSize: 13,
                    fontWeight: FontWeight.w600)),
            Text('$minutes:$seconds',
                style: GoogleFonts.poppins(
                    color: JT.warning,
                    fontSize: 20,
                    fontWeight: FontWeight.w800)),
          ]),
        ),
        Container(width: 1, height: 44, color: JT.border),
        const SizedBox(width: 14),
        Expanded(
          flex: 2,
          child: Row(children: [
            const Icon(Icons.info_outline_rounded,
                color: JT.textSecondary, size: 18),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Start only after customer shares the OTP.',
                  style: GoogleFonts.poppins(
                      color: JT.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w500)),
            ),
          ]),
        ),
      ]),
    );
  }

  Widget _buildTopBar(String pickup, String dest) {
    return Container(
      height: 72,
      padding: const EdgeInsets.symmetric(horizontal: 18),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(children: [
        Expanded(
          child: Align(
            alignment: Alignment.centerLeft,
            child: IconButton(
              onPressed: () => _showSnack('Active ride in progress'),
              icon: const Icon(Icons.menu_rounded,
                  color: Colors.black, size: 30),
            ),
          ),
        ),
        Expanded(
          flex: 2,
          child: Text(
            _stageTitle,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              color: Colors.black,
              fontSize: 20,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        Expanded(
          child: Align(
            alignment: Alignment.centerRight,
            child: Container(
              width: 46,
              height: 46,
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                color: Colors.black,
                shape: BoxShape.circle,
              ),
              child: SvgPicture.asset(
                'assets/images/jago_icon_white.svg',
                fit: BoxFit.contain,
              ),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _buildNavigationInstructions() {
    final isOnTheWay = _status == 'in_progress' || _status == 'on_the_way';
    final String instruction =
        isOnTheWay ? 'Go to drop' : 'Go to pickup';

    return Container(
      constraints: const BoxConstraints(maxWidth: 290),
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 13),
      decoration: BoxDecoration(
        color: const Color(0xFFFFC400),
        borderRadius: BorderRadius.circular(28),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.18),
              blurRadius: 14,
              offset: const Offset(0, 8))
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.navigation_rounded, color: Colors.black, size: 22),
          const SizedBox(width: 12),
          Text(
            instruction,
            style: GoogleFonts.poppins(
                color: Colors.black,
                fontSize: 18,
                fontWeight: FontWeight.w700),
          ),
          if (_distanceToTargetM > 0)
            Container(
              margin: const EdgeInsets.only(left: 12),
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
              decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(16)),
              child: Text(
                _formatDist(_distanceToTargetM),
                style: GoogleFonts.poppins(
                    color: Colors.black,
                    fontWeight: FontWeight.w700,
                    fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }

  // ── Customer card ─────────────────────────────────────────────────────────

  Widget _buildRouteStageCard(String pickup, String dest) {
    final targetLabel = _resolveTargetLabel();
    final targetAddress = _resolveTargetAddress();
    final stageColor = _isTripLive ? JT.success : JT.primary;
    final stageTitle = _isHeadingToPickup
        ? 'Pickup Route Live'
        : 'Destination Route Live';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: stageColor.withValues(alpha: 0.18)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 14,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: stageColor.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.alt_route_rounded, color: stageColor, size: 18),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      stageTitle,
                      style: GoogleFonts.poppins(
                        color: stageColor,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      targetAddress.isNotEmpty ? targetAddress : targetLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.poppins(
                        color: JT.textSecondary,
                        fontSize: 11,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: stageColor.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  _etaSec > 0 ? _formatEta(_etaSec) : 'Live',
                  style: GoogleFonts.poppins(
                    color: stageColor,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _buildMiniRouteStop(
                  icon: Icons.radio_button_checked_rounded,
                  label: 'Pickup',
                  value: pickup,
                  active: _isHeadingToPickup,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildMiniRouteStop(
                  icon: Icons.location_on_rounded,
                  label: 'Destination',
                  value: dest,
                  active: !_isHeadingToPickup,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _loading ? null : _openNavigation,
                  icon: const Icon(Icons.center_focus_strong_rounded, size: 18),
                  label: const Text('View Route'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: stageColor,
                    side: BorderSide(color: stageColor.withValues(alpha: 0.28)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _loading
                      ? null
                      : () => _focusRouteOnMap(showReadySnack: true),
                  icon: const Icon(Icons.navigation_rounded, size: 18),
                  label:
                      Text(_isTripLive ? 'Focus Destination' : 'Focus Pickup'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: stageColor,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMiniRouteStop({
    required IconData icon,
    required String label,
    required String value,
    required bool active,
  }) {
    final color = active ? JT.primary : JT.textSecondary;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: active ? JT.bgSoft : JT.surfaceAlt,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: active ? JT.primary.withValues(alpha: 0.20) : JT.border,
        ),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: GoogleFonts.poppins(
                    color: color,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(
                    color: JT.textPrimary,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCustomerCard(String name, String? phone) {
    final pm = _trip?['paymentMethod'] ?? _trip?['payment_method'] ?? 'cash';
    final pmLabel = pm == 'wallet'
        ? 'Wallet'
        : (pm == 'upi' || pm == 'online' || pm == 'razorpay')
            ? 'UPI'
            : 'Cash';
    final pmColor = pm == 'wallet'
        ? JT.primary
        : (pm == 'upi' || pm == 'online' || pm == 'razorpay')
            ? JT.secondary
            : JT.success;
    final fare = double.tryParse(
            (_trip?['estimatedFare'] ?? _trip?['estimated_fare'] ?? 0)
                .toString()) ??
        0;
    final address = _resolveTargetAddress();

    return Container(
      decoration: BoxDecoration(
          color: JT.bgSoft,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: JT.border)),
      child: Column(children: [
        Padding(
          padding: const EdgeInsets.all(14),
          child: Row(children: [
            Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                    gradient: JT.grad,
                    borderRadius: BorderRadius.circular(15),
                    boxShadow: JT.btnShadow),
                child: Center(
                    child: Text(name.isNotEmpty ? name[0].toUpperCase() : 'C',
                        style: const TextStyle(
                            color: Colors.white,
                            fontSize: 22,
                            fontWeight: FontWeight.w500)))),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text(name,
                      style: GoogleFonts.poppins(
                          color: JT.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w400),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 3),
                  Text(pmLabel,
                      style: GoogleFonts.poppins(
                          color: pmColor,
                          fontSize: 12,
                          fontWeight: FontWeight.w500)),
                  if (address.trim().isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(address,
                        style: GoogleFonts.poppins(
                            color: JT.textSecondary,
                            fontSize: 12,
                            height: 1.35),
                        maxLines: _isTripLive ? 1 : 3,
                        overflow: TextOverflow.ellipsis),
                  ],
                ])),
            if (phone != null)
              GestureDetector(
                  onTap: () => _startInAppCall(name),
                  child: Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(
                          gradient: JT.grad,
                          borderRadius: BorderRadius.circular(14),
                          boxShadow: JT.btnShadow),
                      child: const Icon(Icons.phone_rounded,
                          color: Colors.white, size: 20))),
          ]),
        ),
        Container(height: 1, color: JT.border),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Row(children: [
            Expanded(
                child: _pill(
                    'Fare', fare > 0 ? '₹${fare.toInt()}' : '₹--', JT.success)),
            const SizedBox(width: 6),
            Expanded(
                child: _pill(
                    'Distance',
                    (double.tryParse((_trip?['estimatedDistance'] ?? 0)
                                    .toString()) ??
                                0) >
                            0
                        ? '${(double.parse(_trip!['estimatedDistance'].toString())).toStringAsFixed(1)} km'
                        : '--',
                    JT.primary)),
            const SizedBox(width: 6),
            Expanded(child: _pill('Pay', pmLabel, pmColor)),
          ]),
        ),
      ]),
    );
  }

  Widget _pill(String label, String value, Color color) => Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
          color: color.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: color.withValues(alpha: 0.15))),
      child: Column(children: [
        Text(value,
            style: GoogleFonts.poppins(
                color: color, fontSize: 13, fontWeight: FontWeight.w500)),
        const SizedBox(height: 2),
        Text(label,
            style: GoogleFonts.poppins(
                color: JT.textSecondary,
                fontSize: 9,
                fontWeight: FontWeight.w400)),
      ]));

  // ── Live stats (distance/ETA/timer) ───────────────────────────────────────

  Widget _buildLiveStats() {
    final isOnTheWay = _status == 'in_progress' || _status == 'on_the_way';
    final isNavigating = _status == 'accepted' || _status == 'driver_assigned';

    if (_status == 'arrived') {
      return Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
              color: JT.warning.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: JT.warning.withValues(alpha: 0.3))),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.location_on_rounded, color: JT.warning, size: 18),
            const SizedBox(width: 8),
            Text('At pickup — waiting for customer',
                style: GoogleFonts.poppins(
                    color: JT.warning,
                    fontSize: 13,
                    fontWeight: FontWeight.w500)),
          ]));
    }

    if (!isNavigating && !isOnTheWay) return const SizedBox.shrink();

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
          color: isOnTheWay
              ? JT.success.withValues(alpha: 0.06)
              : JT.primary.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
              color:
                  isOnTheWay ? JT.success.withValues(alpha: 0.2) : JT.border)),
      child: Row(children: [
        Icon(isOnTheWay ? Icons.speed_rounded : Icons.navigation_rounded,
            color: isOnTheWay ? JT.success : JT.primary, size: 18),
        const SizedBox(width: 10),
        Expanded(
            child: Row(children: [
          Text(_distanceToTargetM > 0 ? _formatDist(_distanceToTargetM) : '--',
              style: GoogleFonts.poppins(
                  color: isOnTheWay ? JT.success : JT.primary,
                  fontSize: 15,
                  fontWeight: FontWeight.w500)),
          const SizedBox(width: 6),
          Text('away',
              style:
                  GoogleFonts.poppins(color: JT.textSecondary, fontSize: 12)),
          const SizedBox(width: 12),
          const Icon(Icons.access_time_rounded,
              size: 13, color: JT.iconInactive),
          const SizedBox(width: 4),
          Text(_etaSec > 0 ? _formatEta(_etaSec) : '--',
              style: GoogleFonts.poppins(
                  color: JT.textSecondary,
                  fontSize: 12,
                  fontWeight: FontWeight.w400)),
        ])),
        if (isOnTheWay && _tripElapsedSec > 0)
          Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                  color: JT.success.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(20)),
              child: Text(_formatElapsed(_tripElapsedSec),
                  style: GoogleFonts.poppins(
                      color: JT.success,
                      fontSize: 12,
                      fontWeight: FontWeight.w400))),
        if (_nearPickup && isNavigating)
          Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                  color: JT.success.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: JT.success.withValues(alpha: 0.4))),
              child: Text('Near Pickup!',
                  style: GoogleFonts.poppins(
                      color: JT.success,
                      fontSize: 11,
                      fontWeight: FontWeight.w400))),
      ]),
    );
  }

  // ── Payment badge ─────────────────────────────────────────────────────────

  Widget _buildPaymentBadge() {
    final pm = _trip?['paymentMethod'] ?? _trip?['payment_method'] ?? 'cash';
    final isCash = pm == 'cash';
    final fare = double.tryParse(
            (_trip?['estimatedFare'] ?? _trip?['estimated_fare'] ?? 0)
                .toString()) ??
        0;

    if (isCash && (_status == 'in_progress' || _status == 'on_the_way')) {
      return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
              gradient: JT.grad,
              borderRadius: BorderRadius.circular(14),
              boxShadow: JT.btnShadow),
          child: Row(children: [
            Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(11)),
                child: const Icon(Icons.payments_rounded,
                    color: Colors.white, size: 20)),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text('COLLECT ₹${fare.toInt()} CASH',
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w400,
                          fontSize: 13,
                          letterSpacing: 0.5)),
                  const Text('Remind customer to have exact change',
                      style: TextStyle(color: Colors.white70, fontSize: 11)),
                ])),
          ]));
    }
    if (isCash) {
      return Container(
          margin: const EdgeInsets.only(bottom: 6),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
              color: JT.success.withValues(alpha: 0.07),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: JT.success.withValues(alpha: 0.20))),
          child: const Row(children: [
            Icon(Icons.payments_rounded, color: JT.success, size: 14),
            SizedBox(width: 7),
            Text('Cash Payment — Collect at trip end',
                style: TextStyle(
                    color: JT.success,
                    fontSize: 11,
                    fontWeight: FontWeight.w400)),
          ]));
    }
    return Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
            color: JT.primary.withValues(alpha: 0.05),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: JT.border)),
        child: Row(children: [
          const Icon(Icons.account_balance_wallet_rounded,
              color: JT.primary, size: 14),
          const SizedBox(width: 7),
          Text(
              pm == 'wallet'
                  ? 'Wallet — Auto deducted'
                  : 'Online — Already paid',
              style: GoogleFonts.poppins(
                  color: JT.primary,
                  fontSize: 11,
                  fontWeight: FontWeight.w400)),
        ]));
  }

  // ── Delivery OTP button ───────────────────────────────────────────────────

  Widget _buildDeliveryOtpBtn() => GestureDetector(
      onTap: _showDeliveryOtpDialog,
      child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          margin: const EdgeInsets.only(bottom: 4),
          decoration: BoxDecoration(
              color: JT.warning.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: JT.warning.withValues(alpha: 0.3))),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.lock_open_rounded, color: JT.warning, size: 17),
            const SizedBox(width: 7),
            Text('Verify Delivery OTP',
                style: GoogleFonts.poppins(
                    color: JT.warning,
                    fontSize: 13,
                    fontWeight: FontWeight.w400)),
          ])));

  // ── Main action button ────────────────────────────────────────────────────

  Widget _buildActionBtn() {
    final step = _getStepInfo();
    final isOnTheWay = _status == 'in_progress' || _status == 'on_the_way';
    final isArrived = _status == 'arrived';
    final needsSlideArrive =
        _status == 'accepted' || _status == 'driver_assigned';

    if (needsSlideArrive && !_loading) {
      return _buildSlideToArriveBtn();
    }

    final buttonColor = isOnTheWay
        ? JT.error
        : isArrived
            ? JT.success
            : JT.primary;
    final showGlow =
        _nearPickup && (_status == 'accepted' || _status == 'driver_assigned');

    return GestureDetector(
      onTap: _loading ? null : _nextStep,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        width: double.infinity,
        height: 60,
        margin: const EdgeInsets.only(top: 6),
        decoration: BoxDecoration(
          color: buttonColor,
          borderRadius: BorderRadius.circular(30),
          boxShadow: [
            BoxShadow(
                color: buttonColor.withValues(alpha: showGlow ? 0.55 : 0.35),
                blurRadius: showGlow ? 28 : 18,
                offset: const Offset(0, 6)),
          ],
          border: showGlow ? Border.all(color: JT.success, width: 2) : null,
        ),
        child: Center(
          child: _loading
              ? const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                      SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                              color: Colors.white, strokeWidth: 2.5)),
                      SizedBox(width: 12),
                      Text('Please wait...',
                          style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w500,
                              fontSize: 14)),
                    ])
              : Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.18),
                          shape: BoxShape.circle),
                      child: Icon(step['icon'] as IconData,
                          color: Colors.white, size: 20)),
                  const SizedBox(width: 12),
                  Text(step['action'] as String,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                          letterSpacing: -0.2)),
                ]),
        ),
      ),
    );
  }

  Widget _buildSlideToArriveBtn() {
    return LayoutBuilder(builder: (context, constraints) {
      final trackWidth = constraints.maxWidth;
      final maxSlide = (trackWidth - 60).clamp(0.0, double.infinity);
      return Container(
        margin: const EdgeInsets.only(top: 6),
        height: 60,
        child: Stack(
          children: [
            Container(
              width: trackWidth,
              decoration: BoxDecoration(
                color: JT.primaryLight,
                borderRadius: BorderRadius.circular(30),
                border: Border.all(color: JT.primary.withValues(alpha: 0.2)),
              ),
              alignment: Alignment.center,
              child: Text(
                _nearPickup ? 'Slide to mark Arrived →' : 'Move closer to pickup →',
                style: GoogleFonts.poppins(
                  color: _nearPickup ? JT.primaryDark : JT.textSecondary,
                  fontWeight: FontWeight.w500,
                  fontSize: 14,
                ),
              ),
            ),
            Positioned(
              left: _arriveSlideOffset.clamp(0, maxSlide),
              top: 0,
              child: GestureDetector(
                onHorizontalDragUpdate: (d) {
                  setState(() {
                    _arriveSlideOffset =
                        (_arriveSlideOffset + d.delta.dx).clamp(0, maxSlide);
                  });
                },
                onHorizontalDragEnd: (_) {
                  if (!_nearPickup) {
                    setState(() => _arriveSlideOffset = 0);
                    _showSnack('Move within 100m of pickup to mark arrived.', error: true);
                    return;
                  }
                  if (_arriveSlideOffset >= maxSlide * 0.82) {
                    setState(() => _arriveSlideOffset = 0);
                    HapticFeedback.heavyImpact();
                    _nextStep();
                  } else {
                    setState(() => _arriveSlideOffset = 0);
                  }
                },
                child: Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    color: JT.primary,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: JT.primary.withValues(alpha: 0.35),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: const Icon(Icons.double_arrow_rounded,
                      color: Colors.white, size: 24),
                ),
              ),
            ),
          ],
        ),
      );
    });
  }

  // ── Quick action row ──────────────────────────────────────────────────────

  Widget _buildQuickActions(String? phone) {
    return Wrap(
        alignment: WrapAlignment.center,
        spacing: 8,
        runSpacing: 8,
        children: [
          if (phone != null)
            _quickBtn(Icons.phone_rounded, 'Call', JT.primary, () {
              final n = (_trip?['customerName'] ??
                      _trip?['customer_name'] ??
                      'Customer')
                  .toString();
              _startInAppCall(n);
            }),
          _quickBtn(Icons.chat_rounded, 'Chat', JT.primary, _openTripChat),
          _quickBtn(Icons.navigation_rounded, 'Navigate', JT.primary,
              _openNavigation),
          if (_status == 'accepted' ||
              _status == 'driver_assigned' ||
              _status == 'arrived')
            _quickBtn(
                Icons.cancel_outlined, 'Cancel', JT.warning, _showCancelDialog),
          _quickBtn(Icons.sos_rounded, 'SOS', JT.error, _triggerSos),
        ]);
  }

  Widget _quickBtn(
          IconData icon, String label, Color color, VoidCallback onTap) =>
      GestureDetector(
          onTap: onTap,
          child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: color.withValues(alpha: 0.22))),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(icon, color: color, size: 15),
                const SizedBox(width: 5),
                Text(label,
                    style: GoogleFonts.poppins(
                        color: color,
                        fontSize: 12,
                        fontWeight: FontWeight.w500)),
              ])));

  // ── Parcel card ───────────────────────────────────────────────────────────

  Widget _buildParcelCard(String notes) {
    String receiver = '', category = '', weight = '', instructions = '';
    for (final part in notes.split(' | ')) {
      if (part.startsWith('Category:'))
        category = part.replaceFirst('Category: ', '');
      if (part.startsWith('Weight:'))
        weight = part.replaceFirst('Weight: ', '');
      if (part.startsWith('Receiver:'))
        receiver = part.replaceFirst('Receiver: ', '');
      if (part.startsWith('Instructions:') && !part.contains('None'))
        instructions = part.replaceFirst('Instructions: ', '');
    }
    return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: JT.warning.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: JT.warning.withValues(alpha: 0.25))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            const Text('📦', style: TextStyle(fontSize: 15)),
            const SizedBox(width: 7),
            Text('PARCEL',
                style: GoogleFonts.poppins(
                    color: JT.warning,
                    fontSize: 10,
                    fontWeight: FontWeight.w400,
                    letterSpacing: 1)),
          ]),
          if (receiver.isNotEmpty) ...[
            const SizedBox(height: 6),
            Row(children: [
              const Icon(Icons.person_rounded, color: JT.warning, size: 14),
              const SizedBox(width: 5),
              Expanded(
                  child: Text(receiver,
                      style: GoogleFonts.poppins(
                          color: JT.textSecondary,
                          fontSize: 12,
                          fontWeight: FontWeight.w400)))
            ]),
          ],
          if (category.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text('$category  •  $weight',
                style:
                    GoogleFonts.poppins(color: JT.textSecondary, fontSize: 11)),
          ],
          if (instructions.isNotEmpty) ...[
            const SizedBox(height: 3),
            Text(instructions,
                style:
                    GoogleFonts.poppins(color: JT.textSecondary, fontSize: 11)),
          ],
        ]));
  }

  // ── Passenger card ────────────────────────────────────────────────────────

  Widget _buildPassengerCard(String passengerName, String? passengerPhone) =>
      Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
              color: JT.surfaceAlt,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: JT.border)),
          child: Row(children: [
            Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                    color: JT.primary.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(10)),
                child: const Icon(Icons.person_pin_rounded,
                    color: JT.primary, size: 17)),
            const SizedBox(width: 10),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text('PASSENGER',
                      style: GoogleFonts.poppins(
                          color: JT.primary,
                          fontSize: 9,
                          fontWeight: FontWeight.w400,
                          letterSpacing: 1)),
                  Text(passengerName,
                      style: GoogleFonts.poppins(
                          color: JT.textPrimary,
                          fontSize: 13,
                          fontWeight: FontWeight.w500)),
                  if (passengerPhone != null && passengerPhone.isNotEmpty)
                    Text(passengerPhone,
                        style: GoogleFonts.poppins(
                            color: JT.textSecondary, fontSize: 11)),
                ])),
          ]));

  // ── Step info ─────────────────────────────────────────────────────────────

  Map<String, dynamic> _getStepInfo() {
    switch (_status) {
      case 'driver_assigned':
      case 'accepted':
        return {
          'label': 'Go to Pickup Zone',
          'icon': Icons.navigation_rounded,
          'action': 'Arrived'
        };
      case 'arrived':
        return {
          'label': 'Meet the Customer',
          'icon': Icons.lock_open_rounded,
          'action': 'Start Ride'
        };
      case 'in_progress':
      case 'on_the_way':
        return {
          'label': 'Trip in Progress',
          'icon': Icons.speed_rounded,
          'action': 'Complete Ride'
        };
      default:
        return {
          'label': 'Trip Active',
          'icon': Icons.electric_bike,
          'action': 'Next Step'
        };
    }
  }
}
