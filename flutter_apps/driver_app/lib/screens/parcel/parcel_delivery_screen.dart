import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/navigation_service.dart';
import '../../services/socket_service.dart';
import '../../services/error_reporting.dart';
import '../home/home_screen.dart';

List<LatLng> _decodePolyline(String encoded) {
  final points = <LatLng>[];
  int index = 0;
  int lat = 0;
  int lng = 0;

  while (index < encoded.length) {
    int shift = 0;
    int result = 0;
    int byte;
    do {
      byte = encoded.codeUnitAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      byte = encoded.codeUnitAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

    points.add(LatLng(lat / 1e5, lng / 1e5));
  }
  return points;
}

// ─────────────────────────────────────────────────────────────────────────────
// JAGO Driver — Parcel Delivery Screen
// Stages: navigating_pickup → verify_pickup_otp → navigating_drop → verify_drop_otp → completed
// Supports multi-drop (Porter-style)
// ─────────────────────────────────────────────────────────────────────────────

enum _ParcelStage {
  navigatingToPickup,
  atPickup,
  navigatingToDrop,
  atDrop,
  completed,
}

class ParcelDeliveryScreen extends StatefulWidget {
  final Map<String, dynamic> order;
  const ParcelDeliveryScreen({super.key, required this.order});

  @override
  State<ParcelDeliveryScreen> createState() => _ParcelDeliveryScreenState();
}

class _ParcelDeliveryScreenState extends State<ParcelDeliveryScreen>
    with SingleTickerProviderStateMixin {

  final SocketService _socket = SocketService();
  final NavigationService _navigation = NavigationService.instance;
  final _otpCtrl = TextEditingController();
  late AnimationController _pulseCtrl;
  Timer? _locationTimer;
  GoogleMapController? _mapController;
  Position? _lastPosition;
  LatLng _mapCenter = const LatLng(17.3850, 78.4867);
  final Set<Marker> _markers = {};
  final Set<Polyline> _polylines = {};
  double _distanceToTargetM = 0;
  int _etaSec = 0;
  List<NavigationStepModel> _navSteps = const [];
  int _navStepIndex = 0;
  String _navInstruction = 'Follow the highlighted route';
  String _navSecondaryInstruction = 'Navigation guidance will appear here';
  bool _navMuted = false;
  bool _isRerouting = false;
  bool _isOffRoute = false;
  int _offRouteHits = 0;
  DateTime? _lastRerouteAt;

  _ParcelStage _stage = _ParcelStage.navigatingToPickup;
  bool _loading = false;

  late Map<String, dynamic> _order;
  late List<Map<String, dynamic>> _drops;
  int _dropIdx = 0;
  double _driverEarnings = 0;

  @override
  void initState() {
    super.initState();
    _order = Map<String, dynamic>.from(widget.order);
    final raw = _order['drop_locations'];
    if (raw is List) {
      _drops = raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } else if (raw is String) {
      final decoded = jsonDecode(raw);
      _drops = (decoded as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } else {
      _drops = [];
    }
    _dropIdx = (_order['current_drop_index'] as int?) ?? 0;

    // Restore stage if order was already in transit (driver resumed app)
    final status = _order['current_status']?.toString() ?? 'driver_assigned';
    if (status == 'in_transit') {
      _stage = _dropIdx < _drops.length
          ? _ParcelStage.navigatingToDrop
          : _ParcelStage.completed;
    }

    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 2),
    )..repeat(reverse: true);

    _navigation.init();
    _socket.connect(ApiConfig.socketUrl);
    _startLocationUpdates();
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncMapForStage());
  }

  @override
  void dispose() {
    _otpCtrl.dispose();
    _pulseCtrl.dispose();
    _locationTimer?.cancel();
    _socket.disconnect();
    super.dispose();
  }

  String get _orderId => _order['id']?.toString() ?? '';

  Future<void> _startLocationUpdates() async {
    await _refreshDriverPosition(fetchRoute: true);
    _locationTimer = Timer.periodic(const Duration(seconds: 8), (_) async {
      await _refreshDriverPosition(fetchRoute: true);
    });
  }

  Future<void> _refreshDriverPosition({bool fetchRoute = false}) async {
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings:
            const LocationSettings(accuracy: LocationAccuracy.high),
      );
      _lastPosition = pos;
      if (!mounted) return;
      setState(() {
        _mapCenter = LatLng(pos.latitude, pos.longitude);
      });
      _socket.sendLocation(
        lat: pos.latitude,
        lng: pos.longitude,
        remainingDistanceMeters: _distanceToTargetM.round(),
        etaSeconds: _etaSec,
      );
      await _syncMapForStage(fetchRoute: fetchRoute);
      await _updateNavigationProgress();
      await _maybeHandleOffRoute(pos.latitude, pos.longitude);
    } catch (e, st) {
      reportSilentFailure('ParcelDeliveryScreen._refreshDriverPosition', e, st);
    }
  }

  LatLng? _targetLatLng() {
    if (_stage == _ParcelStage.navigatingToPickup ||
        _stage == _ParcelStage.atPickup) {
      final lat = double.tryParse(_order['pickup_lat']?.toString() ?? '0') ?? 0;
      final lng = double.tryParse(_order['pickup_lng']?.toString() ?? '0') ?? 0;
      if (lat == 0 || lng == 0) return null;
      return LatLng(lat, lng);
    }

    final drop = _dropIdx < _drops.length ? _drops[_dropIdx] : null;
    final lat = double.tryParse(drop?['lat']?.toString() ?? '0') ?? 0;
    final lng = double.tryParse(drop?['lng']?.toString() ?? '0') ?? 0;
    if (lat == 0 || lng == 0) return null;
    return LatLng(lat, lng);
  }

  String _targetLabel() {
    if (_stage == _ParcelStage.navigatingToPickup ||
        _stage == _ParcelStage.atPickup) {
      return (_order['pickup_address']?.toString() ?? 'Pickup').trim();
    }
    final drop = _dropIdx < _drops.length ? _drops[_dropIdx] : null;
    return (drop?['address']?.toString() ?? 'Drop').trim();
  }

  Future<void> _syncMapForStage({bool fetchRoute = true}) async {
    final target = _targetLatLng();
    if (!mounted) return;
    setState(() {
      _markers.clear();
      if (_lastPosition != null) {
        _markers.add(Marker(
          markerId: const MarkerId('driver'),
          position: LatLng(_lastPosition!.latitude, _lastPosition!.longitude),
          icon:
              BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
          infoWindow: const InfoWindow(title: 'You'),
        ));
      }
      if (target != null) {
        _markers.add(Marker(
          markerId: const MarkerId('target'),
          position: target,
          icon: BitmapDescriptor.defaultMarkerWithHue(
            _stage == _ParcelStage.navigatingToPickup ||
                    _stage == _ParcelStage.atPickup
                ? BitmapDescriptor.hueGreen
                : BitmapDescriptor.hueRed,
          ),
          infoWindow: InfoWindow(title: _targetLabel()),
        ));
      }
    });

    if (fetchRoute && _lastPosition != null && target != null) {
      await _fetchRoute(
        _lastPosition!.latitude,
        _lastPosition!.longitude,
        target.latitude,
        target.longitude,
      );
    } else {
      await _focusMap();
    }
  }

  Future<void> _updateNavigationProgress() async {
    final pos = _lastPosition;
    if (pos == null) return;
    final progress = _navigation.computeProgress(
      steps: _navSteps,
      currentLat: pos.latitude,
      currentLng: pos.longitude,
      fallbackRemainingDistanceMeters: _distanceToTargetM.round(),
      fallbackRemainingDurationSeconds: _etaSec,
    );
    if (!mounted) return;
    setState(() {
      _navStepIndex = progress.stepIndex;
      _distanceToTargetM = progress.remainingDistanceMeters.toDouble();
      _etaSec = progress.remainingDurationSeconds;
      _navInstruction = progress.activeStep?.instruction.isNotEmpty == true
          ? progress.activeStep!.instruction
          : (_stage == _ParcelStage.navigatingToPickup ||
                  _stage == _ParcelStage.atPickup
              ? 'Head to pickup'
              : 'Head to drop');
      _navSecondaryInstruction =
          progress.activeStep?.roadName.isNotEmpty == true
              ? progress.activeStep!.roadName
              : 'Stay on the highlighted route';
    });
    await _navigation.announceStep(progress, muted: _navMuted);
  }

  double _distanceFromRouteMeters(double lat, double lng) {
    final routePoints = _polylines
        .where((line) => line.polylineId.value == 'parcel_route')
        .expand((line) => line.points)
        .toList();
    if (routePoints.isEmpty) return 0;

    double minDistance = double.infinity;
    for (final point in routePoints) {
      final distance = Geolocator.distanceBetween(
        lat,
        lng,
        point.latitude,
        point.longitude,
      );
      if (distance < minDistance) minDistance = distance;
    }
    return minDistance == double.infinity ? 0 : minDistance;
  }

  Future<void> _maybeHandleOffRoute(double lat, double lng) async {
    if (_isRerouting) return;
    final routeDistance = _distanceFromRouteMeters(lat, lng);
    if (routeDistance <= 0) return;
    final now = DateTime.now();
    if (routeDistance > 120) {
      _offRouteHits += 1;
      if (mounted && !_isOffRoute) {
        setState(() {
          _isOffRoute = true;
          _navSecondaryInstruction = 'Off route by ${routeDistance.round()} m';
        });
      }
      final coolingDown = _lastRerouteAt != null &&
          now.difference(_lastRerouteAt!) < const Duration(seconds: 12);
      if (_offRouteHits >= 2 && !coolingDown) {
        _lastRerouteAt = now;
        if (mounted) {
          setState(() {
            _isRerouting = true;
            _navInstruction = 'Finding a better route';
            _navSecondaryInstruction = 'Rerouting from your live position';
          });
        }
        await _syncMapForStage(fetchRoute: true);
        if (!mounted) return;
        setState(() {
          _isRerouting = false;
          _isOffRoute = false;
          _offRouteHits = 0;
        });
      }
      return;
    }

    if (_offRouteHits != 0 || _isOffRoute) {
      if (mounted) {
        setState(() {
          _offRouteHits = 0;
          _isOffRoute = false;
        });
      } else {
        _offRouteHits = 0;
        _isOffRoute = false;
      }
    }
  }

  Future<void> _fetchRoute(
      double fromLat, double fromLng, double toLat, double toLng) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(ApiConfig.routeMultiWaypoint),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'origin': {'lat': fromLat, 'lng': fromLng},
          'destination': {'lat': toLat, 'lng': toLng},
          'waypoints': [],
          'optimize': false,
        }),
      );
      if (res.statusCode != 200 || !mounted) return;
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final encoded = data['overviewPolyline']?.toString();
      if (encoded == null || encoded.isEmpty) return;
      final points = _decodePolyline(encoded);
      final distKm = (data['totalDistanceKm'] as num?)?.toDouble() ?? 0;
      final durMin = (data['totalDurationMinutes'] as num?)?.toDouble() ?? 0;
      final navSteps = _navigation.parseSteps(data['steps']);
      setState(() {
        _polylines
          ..clear()
          ..add(Polyline(
            polylineId: const PolylineId('parcel_route'),
            points: points,
            color: JT.primary,
            width: 5,
          ));
        _distanceToTargetM = distKm * 1000;
        _etaSec = (durMin * 60).round();
        _navSteps = navSteps;
        _navStepIndex = 0;
        _isRerouting = false;
        _isOffRoute = false;
        _offRouteHits = 0;
        if (navSteps.isNotEmpty) {
          _navInstruction = navSteps.first.instruction;
          _navSecondaryInstruction = navSteps.first.roadName.isNotEmpty
              ? navSteps.first.roadName
              : 'Stay on the highlighted route';
        } else {
          _navInstruction =
              _stage == _ParcelStage.navigatingToPickup || _stage == _ParcelStage.atPickup
                  ? 'Head to pickup'
                  : 'Head to drop';
          _navSecondaryInstruction = 'Stay on the highlighted route';
        }
      });
      await _updateNavigationProgress();
      await _focusMap();
    } catch (e, st) {
      reportSilentFailure('ParcelDeliveryScreen._fetchRoute', e, st);
    }
  }

  Future<void> _focusMap() async {
    if (_mapController == null) return;
    final points = <LatLng>[
      ..._markers.map((marker) => marker.position),
      ..._polylines.expand((line) => line.points),
    ];
    if (points.isEmpty) return;
    if (points.length == 1) {
      await _mapController!.animateCamera(
        CameraUpdate.newCameraPosition(
          CameraPosition(target: points.first, zoom: 16),
        ),
      );
      return;
    }

    double minLat = points.first.latitude;
    double maxLat = points.first.latitude;
    double minLng = points.first.longitude;
    double maxLng = points.first.longitude;
    for (final point in points.skip(1)) {
      if (point.latitude < minLat) minLat = point.latitude;
      if (point.latitude > maxLat) maxLat = point.latitude;
      if (point.longitude < minLng) minLng = point.longitude;
      if (point.longitude > maxLng) maxLng = point.longitude;
    }
    await _mapController!.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(minLat, minLng),
          northeast: LatLng(maxLat, maxLng),
        ),
        64,
      ),
    );
  }

  Future<void> _openNavigation() async {
    final target = _targetLatLng();
    if (target == null) {
      _showSnack('Route coordinates are not available yet.', error: true);
      return;
    }
    await _syncMapForStage(fetchRoute: true);
    _showSnack('Showing in-app route to ${_targetLabel()}');
  }

  Future<void> _verifyPickupOtp() async {
    final otp = _otpCtrl.text.trim();
    if (otp.length < 4) { _showSnack('Enter 4-digit pickup OTP', error: true); return; }
    setState(() => _loading = true);
    try {
      final hdrs = await AuthService.getHeaders();
      hdrs['Content-Type'] = 'application/json';
      final r = await http.post(
        Uri.parse(ApiConfig.driverParcelPickupOtp(_orderId)),
        headers: hdrs,
        body: jsonEncode({'otp': otp}),
      );
      if (r.statusCode == 200) {
        HapticFeedback.heavyImpact();
        _otpCtrl.clear();
        setState(() {
          _stage = _drops.isNotEmpty
              ? _ParcelStage.navigatingToDrop
              : _ParcelStage.completed;
        });
        if (_stage == _ParcelStage.navigatingToDrop) {
          _syncMapForStage();
        }
      } else {
        final e = jsonDecode(r.body);
        _showSnack(e['message'] ?? 'Wrong OTP', error: true);
      }
    } catch (_) {
      _showSnack('Network error', error: true);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _verifyDropOtp() async {
    final otp = _otpCtrl.text.trim();
    if (otp.length < 4) { _showSnack('Enter 4-digit delivery OTP', error: true); return; }
    setState(() => _loading = true);
    try {
      final hdrs = await AuthService.getHeaders();
      hdrs['Content-Type'] = 'application/json';
      final r = await http.post(
        Uri.parse(ApiConfig.driverParcelDropOtp(_orderId)),
        headers: hdrs,
        body: jsonEncode({'dropIndex': _dropIdx, 'otp': otp}),
      );
      if (r.statusCode == 200) {
        final data = jsonDecode(r.body);
        HapticFeedback.heavyImpact();
        _otpCtrl.clear();
        final allDelivered = data['allDelivered'] == true;
        if (allDelivered) {
          // FIX: this used to hardcode a flat 15% commission split, which silently
          // disagreed with the real, potentially vehicle-wise-configured commission
          // model (see the server-side P0 fix for the GST-inclusive-vs-pre-GST
          // commission-base bug this figure depends on getting right). The server
          // now returns the actual settled driverEarnings in this same response.
          final realEarnings = double.tryParse(data['driverEarnings']?.toString() ?? '');
          setState(() {
            _stage = _ParcelStage.completed;
            if (realEarnings != null) _driverEarnings = realEarnings;
          });
          _syncMapForStage(fetchRoute: false);
        } else {
          setState(() {
            _dropIdx++;
            _stage = _ParcelStage.navigatingToDrop;
          });
          _syncMapForStage();
        }
      } else {
        final e = jsonDecode(r.body);
        _showSnack(e['message'] ?? 'Wrong OTP', error: true);
      }
    } catch (_) {
      _showSnack('Network error', error: true);
    }
    if (mounted) setState(() => _loading = false);
  }

  Future<void> _showParcelCompletionReviewSheet() async {
    final fare = double.tryParse(_order['total_fare']?.toString() ?? '0') ?? 0;
    final paymentMethod =
        (_order['payment_method'] ?? _order['paymentMethod'] ?? 'online')
            .toString()
            .trim()
            .toLowerCase();
    final isCash = paymentMethod == 'cash';
    bool paymentConfirmed = !isCash;

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setS) => Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.fromLTRB(24, 12, 24, 32),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: JT.border,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                Text(
                  'Confirm parcel payment before completion',
                  style: GoogleFonts.poppins(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                    color: JT.textPrimary,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  isCash
                      ? 'Collect the parcel fare before closing the delivery.'
                      : 'Payment is already settled for this parcel order.',
                  style: GoogleFonts.poppins(
                    fontSize: 13,
                    height: 1.5,
                    color: JT.textSecondary,
                  ),
                ),
                const SizedBox(height: 18),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: JT.bgSoft,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: JT.border),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: _completedSummaryChip(
                          'Payment',
                          isCash ? 'Cash Payment' : 'Online Payment',
                          isCash ? const Color(0xFFF59E0B) : JT.success,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _completedSummaryChip(
                          'Fare',
                          '₹${fare.toStringAsFixed(0)}',
                          JT.primary,
                        ),
                      ),
                    ],
                  ),
                ),
                if (isCash) ...[
                  const SizedBox(height: 16),
                  OutlinedButton.icon(
                    onPressed: paymentConfirmed
                        ? null
                        : () => setS(() => paymentConfirmed = true),
                    icon: Icon(
                      paymentConfirmed
                          ? Icons.check_circle_rounded
                          : Icons.payments_rounded,
                    ),
                    label: Text(
                      paymentConfirmed
                          ? 'Cash collection confirmed'
                          : 'Mark cash collected',
                    ),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      foregroundColor: JT.success,
                      side: BorderSide(
                        color: JT.success.withValues(alpha: 0.35),
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: !paymentConfirmed
                        ? null
                        : () async {
                            Navigator.of(ctx).pop();
                            await _verifyDropOtp();
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: JT.primary,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(56),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    child: Text(
                      'Complete delivery',
                      style: GoogleFonts.poppins(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
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

  void _goHome() {
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const HomeScreen()),
      (_) => false,
    );
  }

  // ── Build ────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      appBar: AppBar(
        backgroundColor: JT.bg,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_ios_new_rounded, color: JT.textPrimary, size: 18),
          onPressed: () => showDialog(
            context: context,
            builder: (_) => AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              title: Text('Leave Delivery?', style: GoogleFonts.poppins(fontWeight: FontWeight.w400)),
              content: Text('You can return to this delivery from your home screen.', style: GoogleFonts.poppins(fontSize: 14)),
              actions: [
                TextButton(onPressed: () => Navigator.pop(context), child: const Text('Stay')),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(backgroundColor: JT.error),
                  onPressed: () { Navigator.pop(context); _goHome(); },
                  child: const Text('Leave', style: TextStyle(color: Colors.white)),
                ),
              ],
            ),
          ),
        ),
        title: Text(
          _stage == _ParcelStage.completed ? 'Delivery Complete!' : 'Parcel Delivery',
          style: GoogleFonts.poppins(color: JT.textPrimary, fontWeight: FontWeight.w400, fontSize: 16),
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 16),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                gradient: JT.grad,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '₹${_order['total_fare'] ?? 0}',
                style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w400, fontSize: 14),
              ),
            ),
          ),
        ],
      ),
      body: _stage == _ParcelStage.completed
          ? _buildCompletedView()
          : LayoutBuilder(
              builder: (context, constraints) {
                final sheetMaxHeight =
                    constraints.maxHeight > 820 ? 320.0 : 300.0;
                return Stack(
                  children: [
                    Positioned.fill(
                      child: GoogleMap(
                        initialCameraPosition:
                            CameraPosition(target: _mapCenter, zoom: 14),
                        onMapCreated: (controller) {
                          _mapController = controller;
                          _syncMapForStage(fetchRoute: false);
                        },
                        myLocationEnabled: true,
                        myLocationButtonEnabled: false,
                        zoomControlsEnabled: false,
                        mapToolbarEnabled: false,
                        padding:
                            EdgeInsets.only(bottom: sheetMaxHeight - 24),
                        markers: _markers,
                        polylines: _polylines,
                      ),
                    ),
                    Positioned(
                      left: 16,
                      right: 16,
                      top: 16,
                      child: _buildProgressBar(),
                    ),
                    Align(
                      alignment: Alignment.bottomCenter,
                      child: Container(
                        constraints:
                            BoxConstraints(maxHeight: sheetMaxHeight),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(24),
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.12),
                              blurRadius: 24,
                              offset: const Offset(0, -8),
                            ),
                          ],
                        ),
                        child: SingleChildScrollView(
                          physics: const ClampingScrollPhysics(),
                          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                          child: Column(
                            children: [
                              _buildSheetHandle(),
                              const SizedBox(height: 12),
                              _buildPackageSummary(),
                              const SizedBox(height: 16),
                              if (_stage == _ParcelStage.navigatingToPickup)
                                _buildNavigatingToPickup(),
                              if (_stage == _ParcelStage.atPickup)
                                _buildAtPickup(),
                              if (_stage == _ParcelStage.navigatingToDrop)
                                _buildNavigatingToDrop(),
                              if (_stage == _ParcelStage.atDrop) _buildAtDrop(),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
    );
  }

  // ── Progress Bar ──────────────────────────────────────────────────────────
  Widget _buildProgressBar() {
    final steps = ['Pickup', ...List.generate(_drops.length, (i) => 'Drop ${i + 1}'), 'Done'];
    int currentStep = 0;
    if (_stage == _ParcelStage.atPickup) currentStep = 0;
    else if (_stage == _ParcelStage.navigatingToDrop || _stage == _ParcelStage.atDrop) currentStep = _dropIdx + 1;
    else if (_stage == _ParcelStage.completed) currentStep = steps.length - 1;

    return Container(
      color: JT.bg,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Step ${currentStep + 1} of ${steps.length}',
          style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary)),
        const SizedBox(height: 6),
        Row(children: List.generate(steps.length, (i) {
          final done = i < currentStep;
          final active = i == currentStep;
          return Expanded(child: Row(children: [
            Expanded(child: AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              height: 6,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(3),
                color: done ? JT.success : active ? JT.primary : JT.border,
              ),
            )),
            if (i < steps.length - 1) const SizedBox(width: 4),
          ]));
        })),
        const SizedBox(height: 4),
        Text(steps[currentStep],
          style: GoogleFonts.poppins(fontSize: 11, fontWeight: FontWeight.w500, color: JT.primary)),
      ]),
    );
  }

  Widget _buildSheetHandle() {
    return Container(
      width: 44,
      height: 4,
      decoration: BoxDecoration(
        color: JT.border,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }

  // ── Package Summary Card ──────────────────────────────────────────────────
  Widget _buildPackageSummary() {
    final vehicleType = _order['vehicle_category']?.toString() ?? 'bike_parcel';
    final vehicleEmoji = vehicleType.contains('pickup') ? '🛻'
        : vehicleType.contains('tata') || vehicleType.contains('mini') ? '🚛' : '🏍️';
    final vehicleName = vehicleType.contains('pickup') ? 'Pickup Truck'
        : vehicleType.contains('tata') || vehicleType.contains('mini') ? 'Mini Truck' : 'Bike Parcel';
    final weight = _order['weight_kg']?.toString() ?? '';
    final stops = _drops.length;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
        boxShadow: JT.cardShadow,
      ),
      child: Column(children: [
        Row(children: [
          Text(vehicleEmoji, style: const TextStyle(fontSize: 28)),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(vehicleName,
              style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w400, color: JT.textPrimary)),
            Text('$stops stop${stops != 1 ? 's' : ''}${weight.isNotEmpty ? ' · $weight kg' : ''}',
              style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
          ])),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text('₹${_order['total_fare'] ?? 0}',
              style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w500, color: JT.primary)),
            Text('Total Fare', style: GoogleFonts.poppins(fontSize: 10, color: JT.textSecondary)),
          ]),
        ]),
        if (_order['notes']?.toString().isNotEmpty == true) ...[
          const SizedBox(height: 10),
          const Divider(height: 1),
          const SizedBox(height: 10),
          Row(children: [
            Icon(Icons.info_outline_rounded, size: 14, color: JT.warning),
            const SizedBox(width: 6),
            Expanded(child: Text(_order['notes'].toString(),
              style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary))),
          ]),
        ],
      ]),
    );
  }

  // ignore: unused_element
  Widget _buildInAppMapCard() {
    final heading = _isRerouting
        ? 'Rerouting'
        : (_stage == _ParcelStage.navigatingToDrop ||
                _stage == _ParcelStage.atDrop
            ? 'In-app route to drop'
            : 'In-app route to pickup');
    final accent = _isRerouting
        ? JT.warning
        : _isOffRoute
            ? JT.error
            : JT.primary;
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Colors.white,
            JT.bgSoft,
            accent.withValues(alpha: 0.08),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: accent.withValues(alpha: 0.16), width: 1.2),
        boxShadow: [
          ...JT.cardShadow,
          BoxShadow(
            color: accent.withValues(alpha: 0.10),
            blurRadius: 22,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        children: [
          ClipRRect(
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
            child: SizedBox(
              height: 220,
              child: GoogleMap(
                initialCameraPosition:
                    CameraPosition(target: _mapCenter, zoom: 14),
                onMapCreated: (controller) {
                  _mapController = controller;
                  _syncMapForStage(fetchRoute: false);
                },
                markers: _markers,
                polylines: _polylines,
                myLocationEnabled: true,
                myLocationButtonEnabled: false,
                zoomControlsEnabled: false,
                mapToolbarEnabled: false,
                compassEnabled: false,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            accent.withValues(alpha: 0.18),
                            accent.withValues(alpha: 0.08),
                          ],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Icon(
                        _isRerouting
                            ? Icons.sync_rounded
                            : Icons.alt_route_rounded,
                        color: accent,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            heading,
                            style: GoogleFonts.poppins(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: JT.textPrimary,
                            ),
                          ),
                          Text(
                            _stage == _ParcelStage.navigatingToPickup ||
                                    _stage == _ParcelStage.atPickup
                                ? 'Pickup leg active'
                                : 'Delivery leg active',
                            style: GoogleFonts.poppins(
                              fontSize: 10,
                              fontWeight: FontWeight.w500,
                              color: accent,
                              letterSpacing: 0.4,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: JT.border),
                      ),
                      child: IconButton(
                        onPressed: () {
                          setState(() => _navMuted = !_navMuted);
                        },
                        icon: Icon(
                          _navMuted
                              ? Icons.volume_off_rounded
                              : Icons.volume_up_rounded,
                          size: 18,
                          color: accent,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      decoration: BoxDecoration(
                        color: accent.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: accent.withValues(alpha: 0.12)),
                      ),
                      child: TextButton.icon(
                        onPressed: _openNavigation,
                        icon: const Icon(Icons.alt_route_rounded, size: 18),
                        label: const Text('Refresh'),
                        style: TextButton.styleFrom(
                          foregroundColor: accent,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Container(
                  width: double.infinity,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.72),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: JT.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _navInstruction,
                        style: GoogleFonts.poppins(
                          fontSize: 13,
                          color: JT.textPrimary,
                          fontWeight: FontWeight.w600,
                          height: 1.2,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _isOffRoute
                            ? 'Off route detected'
                            : _navSecondaryInstruction.isNotEmpty
                                ? _navSecondaryInstruction
                                : _targetLabel(),
                        style: GoogleFonts.poppins(
                          fontSize: 11,
                          color: _isOffRoute ? JT.error : JT.textSecondary,
                          fontWeight: _isOffRoute
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                Text(
                  _targetLabel(),
                  style: GoogleFonts.poppins(
                    fontSize: 11,
                    color: JT.textSecondary,
                    fontWeight: FontWeight.w400,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (_navSteps.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: accent.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      'Step ${_navStepIndex + 1} of ${_navSteps.length}',
                      style: GoogleFonts.poppins(
                        fontSize: 10,
                        color: accent,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                Row(
                  children: [
                    _mapStat(
                      Icons.near_me_rounded,
                      _distanceToTargetM > 0
                          ? '${(_distanceToTargetM / 1000).toStringAsFixed(1)} km'
                          : '--',
                    ),
                    const SizedBox(width: 10),
                    _mapStat(
                      Icons.access_time_rounded,
                      _etaSec > 0 ? '${(_etaSec / 60).ceil()} min' : '--',
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Stage: Navigating to Pickup ───────────────────────────────────────────
  Widget _buildNavigatingToPickup() {
    return Column(children: [
      _buildAddressCard(
        icon: Icons.store_rounded,
        color: JT.success,
        label: 'Pickup Location',
        address: _order['pickup_address']?.toString() ?? '',
        subtitle: _order['pickup_contact_name'] != null
            ? '${_order['pickup_contact_name']} · ${_order['pickup_contact_phone'] ?? ''}'
            : null,
      ),
      const SizedBox(height: 16),
      _buildNavigateButton(),
      const SizedBox(height: 12),
      SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: () {
            setState(() => _stage = _ParcelStage.atPickup);
            _syncMapForStage();
          },
          icon: const Icon(Icons.check_circle_rounded),
          label: Text('Arrived at Pickup', style: GoogleFonts.poppins(fontWeight: FontWeight.w400, fontSize: 15)),
          style: ElevatedButton.styleFrom(
            backgroundColor: JT.success,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      ),
    ]);
  }

  // ── Stage: At Pickup — OTP ────────────────────────────────────────────────
  Widget _buildAtPickup() {
    return Column(children: [
      _buildAddressCard(
        icon: Icons.store_rounded,
        color: JT.success,
        label: 'Pickup Location',
        address: _order['pickup_address']?.toString() ?? '',
      ),
      const SizedBox(height: 20),
      Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              Colors.white,
              JT.primary.withValues(alpha: 0.05),
              JT.bgSoft,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: JT.primary.withValues(alpha: 0.22)),
          boxShadow: [
            ...JT.cardShadow,
            BoxShadow(
              color: JT.primary.withValues(alpha: 0.08),
              blurRadius: 18,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    JT.primary.withValues(alpha: 0.18),
                    JT.primary.withValues(alpha: 0.08),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.lock_open_rounded, color: JT.primary, size: 20),
            ),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Enter Pickup OTP', style: GoogleFonts.poppins(
                fontWeight: FontWeight.w600, fontSize: 15, color: JT.textPrimary)),
              Text('Get OTP from sender', style: GoogleFonts.poppins(
                fontSize: 12, color: JT.textSecondary, fontWeight: FontWeight.w500)),
            ]),
          ]),
          const SizedBox(height: 16),
          TextField(
            controller: _otpCtrl,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              fontSize: 28, fontWeight: FontWeight.w500,
              letterSpacing: 12, color: JT.textPrimary,
            ),
            decoration: InputDecoration(
              counterText: '',
              hintText: '• • • •',
              hintStyle: GoogleFonts.poppins(fontSize: 24, color: JT.border, letterSpacing: 8),
              filled: true,
              fillColor: JT.bgSoft,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: JT.primary, width: 2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _loading ? null : _verifyPickupOtp,
              style: ElevatedButton.styleFrom(
                backgroundColor: JT.primary,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              elevation: 0,
            ),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 220),
                child: _loading
                    ? const SizedBox(
                        key: ValueKey('pickup_loading'),
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2,
                        ),
                      )
                    : Text(
                        'Verify & Pickup Parcel',
                        key: const ValueKey('pickup_ready'),
                        style: GoogleFonts.poppins(
                          fontWeight: FontWeight.w400,
                          fontSize: 15,
                        ),
                      ),
              ),
            ),
          ),
        ]),
      ),
    ]);
  }

  // ── Stage: Navigating to Drop ─────────────────────────────────────────────
  Widget _buildNavigatingToDrop() {
    final drop = _dropIdx < _drops.length ? _drops[_dropIdx] : null;
    if (drop == null) return const SizedBox.shrink();
    return Column(children: [
      if (_drops.length > 1)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              gradient: JT.grad,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Text(
              'Stop ${_dropIdx + 1} of ${_drops.length}',
              style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w500, fontSize: 13),
            ),
          ),
        ),
      _buildAddressCard(
        icon: Icons.flag_rounded,
        color: JT.warning,
        label: 'Drop Location',
        address: drop['address']?.toString() ?? '',
        subtitle: drop['receiverName'] != null
            ? '${drop['receiverName']} · ${drop['receiverPhone'] ?? ''}'
            : null,
      ),
      const SizedBox(height: 16),
      _buildNavigateButton(),
      const SizedBox(height: 12),
      SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: () {
            setState(() => _stage = _ParcelStage.atDrop);
            _syncMapForStage();
          },
          icon: const Icon(Icons.check_circle_rounded),
          label: Text('Arrived at Drop', style: GoogleFonts.poppins(fontWeight: FontWeight.w400, fontSize: 15)),
          style: ElevatedButton.styleFrom(
            backgroundColor: JT.warning,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      ),
    ]);
  }

  // ── Stage: At Drop — OTP ──────────────────────────────────────────────────
  Widget _buildAtDrop() {
    final drop = _dropIdx < _drops.length ? _drops[_dropIdx] : null;
    if (drop == null) return const SizedBox.shrink();
    return Column(children: [
      _buildAddressCard(
        icon: Icons.flag_rounded,
        color: JT.warning,
        label: 'Delivering To',
        address: drop['address']?.toString() ?? '',
        subtitle: drop['receiverName'] != null
            ? '${drop['receiverName']} · ${drop['receiverPhone'] ?? ''}'
            : null,
      ),
      const SizedBox(height: 20),
      Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              Colors.white,
              JT.warning.withValues(alpha: 0.05),
              JT.bgSoft,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: JT.warning.withValues(alpha: 0.24)),
          boxShadow: [
            ...JT.cardShadow,
            BoxShadow(
              color: JT.warning.withValues(alpha: 0.08),
              blurRadius: 18,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    JT.warning.withValues(alpha: 0.18),
                    JT.warning.withValues(alpha: 0.08),
                  ],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(Icons.lock_open_rounded, color: JT.warning, size: 20),
            ),
            const SizedBox(width: 12),
            Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('Enter Delivery OTP', style: GoogleFonts.poppins(
                fontWeight: FontWeight.w600, fontSize: 15, color: JT.textPrimary)),
              Text('Get OTP from receiver', style: GoogleFonts.poppins(
                fontSize: 12, color: JT.textSecondary, fontWeight: FontWeight.w500)),
            ]),
          ]),
          const SizedBox(height: 16),
          TextField(
            controller: _otpCtrl,
            keyboardType: TextInputType.number,
            maxLength: 6,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              fontSize: 28, fontWeight: FontWeight.w500,
              letterSpacing: 12, color: JT.textPrimary,
            ),
            decoration: InputDecoration(
              counterText: '',
              hintText: '• • • •',
              hintStyle: GoogleFonts.poppins(fontSize: 24, color: JT.border, letterSpacing: 8),
              filled: true,
              fillColor: JT.bgSoft,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: JT.warning, width: 2),
              ),
            ),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _loading
                  ? null
                  : () {
                      if (_dropIdx + 1 < _drops.length) {
                        _verifyDropOtp();
                        return;
                      }
                      _showParcelCompletionReviewSheet();
                    },
              style: ElevatedButton.styleFrom(
                backgroundColor: JT.warning,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              elevation: 0,
            ),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 220),
                child: _loading
                    ? const SizedBox(
                        key: ValueKey('drop_loading'),
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2,
                        ),
                      )
                    : Text(
                        _dropIdx + 1 < _drops.length
                            ? 'Confirm Delivery → Next Stop'
                            : 'Complete Delivery',
                        key: ValueKey('drop_${_dropIdx}_$_loading'),
                        style: GoogleFonts.poppins(
                          fontWeight: FontWeight.w400,
                          fontSize: 15,
                        ),
                      ),
              ),
            ),
          ),
        ]),
      ),
    ]);
  }

  // ── Stage: Completed ──────────────────────────────────────────────────────
  Widget _buildCompletedView() {
    final fare = double.tryParse(_order['total_fare']?.toString() ?? '0') ?? 0;
    final earnings = _driverEarnings > 0 ? _driverEarnings : fare * 0.85;
    final commission = fare - earnings;
    final paymentMethod =
        (_order['payment_method'] ?? _order['paymentMethod'] ?? 'online')
            .toString()
            .trim()
            .toLowerCase();
    final paymentLabel = paymentMethod == 'cash'
        ? 'Cash'
        : paymentMethod == 'wallet'
            ? 'Wallet'
            : paymentMethod == 'upi'
                ? 'Online Payment'
                : 'Online Payment';
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Container(
            width: 100, height: 100,
            decoration: BoxDecoration(
              gradient: JT.grad,
              shape: BoxShape.circle,
              boxShadow: [BoxShadow(color: JT.primary.withValues(alpha: 0.35), blurRadius: 32)],
            ),
            child: const Icon(Icons.check_rounded, color: Colors.white, size: 52),
          ),
          const SizedBox(height: 28),
          Text('Delivery Complete!',
            style: GoogleFonts.poppins(
              fontSize: 26, fontWeight: FontWeight.w500, color: JT.textPrimary)),
          const SizedBox(height: 8),
          Text('All ${_drops.length} stop${_drops.length != 1 ? 's' : ''} delivered successfully.',
            style: GoogleFonts.poppins(fontSize: 14, color: JT.textSecondary),
            textAlign: TextAlign.center),
          const SizedBox(height: 32),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: JT.grad,
              borderRadius: BorderRadius.circular(20),
              boxShadow: [BoxShadow(color: JT.primary.withValues(alpha: 0.3), blurRadius: 20, offset: const Offset(0, 6))],
            ),
            child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Your Earnings', style: GoogleFonts.poppins(color: Colors.white70, fontSize: 13)),
                Text('₹${earnings.toStringAsFixed(0)}',
                  style: GoogleFonts.poppins(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w500)),
              ]),
              Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                Text('Order Fare', style: GoogleFonts.poppins(color: Colors.white70, fontSize: 13)),
                Text('₹${fare.toStringAsFixed(0)}',
                  style: GoogleFonts.poppins(color: Colors.white70, fontSize: 18, fontWeight: FontWeight.w500)),
              ]),
            ]),
          ),
          const SizedBox(height: 18),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: JT.surface,
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: JT.primary.withValues(alpha: 0.1)),
              boxShadow: JT.cardShadow,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Delivery Summary',
                  style: GoogleFonts.poppins(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: JT.textPrimary,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Expanded(
                      child: _completedSummaryChip(
                        'Payment',
                        paymentLabel,
                        paymentMethod == 'cash'
                            ? const Color(0xFFF59E0B)
                            : JT.success,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _completedSummaryChip(
                        'Commission',
                        '₹${commission.toStringAsFixed(0)}',
                        JT.primary,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: paymentMethod == 'cash'
                  ? const Color(0xFFFFF7E8)
                  : JT.primary.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: paymentMethod == 'cash'
                    ? const Color(0xFFF59E0B).withValues(alpha: 0.24)
                    : JT.primary.withValues(alpha: 0.12),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  paymentMethod == 'cash'
                      ? Icons.payments_rounded
                      : Icons.account_balance_wallet_rounded,
                  color: paymentMethod == 'cash'
                      ? const Color(0xFFF59E0B)
                      : JT.primary,
                  size: 20,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    paymentMethod == 'cash'
                        ? 'Collect the parcel amount from the customer before closing this delivery.'
                        : 'Payment is already settled. Your earnings will reflect in the normal payout flow.',
                    style: GoogleFonts.poppins(
                      fontSize: 13,
                      height: 1.45,
                      color: JT.textPrimary,
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 28),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _goHome,
              style: ElevatedButton.styleFrom(
                backgroundColor: JT.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              child: Text('Back to Home', style: GoogleFonts.poppins(fontWeight: FontWeight.w400, fontSize: 16)),
            ),
          ),
        ]),
      ),
    );
  }

  // ── Shared Widgets ────────────────────────────────────────────────────────
  Widget _completedSummaryChip(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: GoogleFonts.poppins(
              fontSize: 11,
              color: JT.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: GoogleFonts.poppins(
              fontSize: 15,
              fontWeight: FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAddressCard({
    required IconData icon,
    required Color color,
    required String label,
    required String address,
    String? subtitle,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.25)),
        boxShadow: JT.cardShadow,
      ),
      child: Row(children: [
        Container(
          width: 42, height: 42,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Icon(icon, color: color, size: 22),
        ),
        const SizedBox(width: 14),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary, fontWeight: FontWeight.w400)),
          Text(address,
            style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w500, color: JT.textPrimary),
            maxLines: 2, overflow: TextOverflow.ellipsis),
          if (subtitle != null)
            Text(subtitle,
              style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary),
              maxLines: 1, overflow: TextOverflow.ellipsis),
        ])),
      ]),
    );
  }

  Widget _buildNavigateButton() {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: _openNavigation,
        icon: const Icon(Icons.navigation_rounded),
        label: Text('Show in-app route',
          style: GoogleFonts.poppins(fontWeight: FontWeight.w500, fontSize: 14)),
        style: OutlinedButton.styleFrom(
          foregroundColor: JT.primary,
          side: const BorderSide(color: JT.primary, width: 1.5),
          padding: const EdgeInsets.symmetric(vertical: 13),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        ),
      ),
    );
  }

  Widget _mapStat(IconData icon, String value) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              Colors.white,
              JT.bgSoft,
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: JT.border),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: JT.primary.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Icon(icon, size: 15, color: JT.primary),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                value,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: JT.textPrimary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
