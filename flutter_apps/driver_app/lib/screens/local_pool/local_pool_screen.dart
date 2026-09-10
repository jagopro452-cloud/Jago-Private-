import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:jago_shared_core/jago_shared_core.dart';
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import '../call/call_screen.dart';
import '../chat/trip_chat_sheet.dart';
import '../profile/support_chat_screen.dart';
import '../../widgets/driver/draggable_map_sheet.dart';
import '../../widgets/driver/sheet_handle.dart';
import '../../widgets/pool/pool_status_floating_card.dart';
import '../../widgets/pool/pool_dynamic_action_card.dart';
import '../../widgets/pool/pool_seat_strip.dart';
import '../../widgets/pool/pool_stops_sheet.dart';
import '../../widgets/pool/pool_safety_sheet.dart';
import '../../widgets/pool/pool_incoming_request_modal.dart';

class LocalPoolScreen extends StatefulWidget {
  const LocalPoolScreen({super.key});

  @override
  State<LocalPoolScreen> createState() => _LocalPoolScreenState();
}

class _LocalPoolScreenState extends State<LocalPoolScreen> {
  final SocketService _socket = SocketService();
  final TextEditingController _otpCtrl = TextEditingController();
  Timer? _poller;
  Timer? _locationTimer;
  StreamSubscription<Map<String, dynamic>>? _newPassengerSub;
  StreamSubscription<Map<String, dynamic>>? _seatSub;
  StreamSubscription<Map<String, dynamic>>? _cancelSub;
  StreamSubscription<Map<String, dynamic>>? _callIncomingSub;

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 44,
            height: 44,
            child: CircularProgressIndicator(
              color: JT.primary,
              strokeWidth: 2.5,
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'Preparing your pool dashboard...',
            style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary),
          ),
        ],
      ),
    );
  }

  bool _loading = true;
  bool _starting = false;
  bool _ending = false;
  bool _updatingAccepting = false;
  int _maxSeats = 4;
  // Persistent "Available for Car Share?" opt-in on the driver's registered
  // vehicle — separate from (and a prerequisite for) starting a live pool
  // session below. Loaded from the driver profile, toggled independently.
  bool _carShareEnabled = false;
  bool _loadingCarShareFlag = true;
  bool _updatingCarShareFlag = false;
  // The driver's actual registered vehicle capacity — used to keep the
  // seat-count dropdown from offering more seats than the vehicle really
  // has. The server independently caps maxSeats to this same value, so this
  // is a UX fix (don't offer a choice the vehicle can't fulfill), not a
  // correctness fix — the backend already enforces the real limit either way.
  int? _vehicleTotalSeats;
  String? _vehicleCategoryType;
  BitmapDescriptor? _driverMarkerIcon;
  Map<String, dynamic>? _session;
  List<dynamic> _passengers = [];
  Map<String, dynamic>? _seatState;
  String? _error;
  // Dedupes the in-screen "new request" interrupt modal against repeat
  // pool:new_passenger events for the same request (e.g. a reconnect resend)
  // and is cleared once the driver has acted on that request.
  String? _lastPromptedRequestId;

  @override
  void initState() {
    super.initState();
    // This screen can be reached via Navigator.pushReplacement from
    // HomeScreen._recoverActiveTrip() on app restart (an active Car Share
    // session was found) — HomeScreen.dispose() explicitly disconnects the
    // shared SocketService singleton when that happens, and unlike
    // TripScreen/ParcelDeliveryScreen (which reconnect defensively for the
    // same reason), this screen never did. Result: a driver whose app
    // restarts while Car Share is active gets a dead socket forever — every
    // pool:new_passenger alert is emitted server-side but reaches no one.
    // connect() is a no-op if HomeScreen is still alive underneath and
    // already connected.
    _socket.connect(ApiConfig.socketUrl);
    _wireSocket();
    _load();
    _loadCarShareFlag();
    _poller = Timer.periodic(const Duration(seconds: 8), (_) => _load(silent: true));
  }

  Future<void> _loadCarShareFlag() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(Uri.parse(ApiConfig.driverProfile), headers: headers)
          .timeout(const Duration(seconds: 12));
      if (res.statusCode == 200 && mounted) {
        final body = jsonDecode(res.body);
        final user = (body is Map && body['user'] is Map) ? body['user'] as Map : body;
        final seats = int.tryParse('${user['vehicleCategoryTotalSeats'] ?? ''}');
        final vehicleType = user['vehicleCategoryType']?.toString();
        setState(() {
          _carShareEnabled = user['carShareEnabled'] == true;
          _vehicleTotalSeats = (seats != null && seats > 0) ? seats : null;
          _vehicleCategoryType = (vehicleType != null && vehicleType.isNotEmpty) ? vehicleType : null;
          if (_vehicleTotalSeats != null && _maxSeats > _vehicleTotalSeats!) {
            _maxSeats = _vehicleTotalSeats!;
          }
          _loadingCarShareFlag = false;
        });
        _loadDriverMarkerIcon();
      } else if (mounted) {
        setState(() => _loadingCarShareFlag = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loadingCarShareFlag = false);
    }
  }

  Future<void> _setCarShareEnabled(bool value) async {
    setState(() => _updatingCarShareFlag = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.patch(
        Uri.parse(ApiConfig.updateProfile),
        headers: headers,
        body: jsonEncode({'carShareEnabled': value}),
      ).timeout(const Duration(seconds: 12));
      if (res.statusCode == 200 && mounted) {
        setState(() => _carShareEnabled = value);
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not update Car Share setting. Try again.')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Network issue while updating Car Share setting')),
        );
      }
    } finally {
      if (mounted) setState(() => _updatingCarShareFlag = false);
    }
  }

  @override
  void dispose() {
    _poller?.cancel();
    _locationTimer?.cancel();
    _newPassengerSub?.cancel();
    _seatSub?.cancel();
    _cancelSub?.cancel();
    _callIncomingSub?.cancel();
    _otpCtrl.dispose();
    super.dispose();
  }

  void _wireSocket() {
    _newPassengerSub = _socket.onPoolNewPassenger.listen((event) {
      _load(silent: true);
      _maybeShowIncomingRequestModal(event);
    });
    _seatSub = _socket.onPoolSeatUpdate.listen((event) {
      if (!mounted) return;
      setState(() => _seatState = event);
    });
    _cancelSub = _socket.onPoolPassengerCancelled.listen((_) => _load(silent: true));
    _callIncomingSub = _socket.onCallIncoming.listen((event) {
      final scope = event['callScope']?.toString();
      final poolModule = event['poolModule']?.toString();
      final referenceId = event['tripId']?.toString() ?? '';
      if (scope != 'pool' || poolModule != 'local_pool' || !mounted) return;
      final passenger = _passengers.cast<Map<String, dynamic>?>().firstWhere(
        (item) => item?['id']?.toString() == referenceId,
        orElse: () => null,
      );
      if (passenger == null) return;
      final callerId = event['callerId']?.toString() ?? '';
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CallScreen(
            contactName: event['callerName']?.toString() ?? passenger['customer_name']?.toString() ?? 'Passenger',
            tripId: referenceId,
            targetUserId: callerId,
            isIncoming: true,
            callerIdForIncoming: callerId,
            callScope: 'pool',
            poolModule: 'local_pool',
          ),
        ),
      );
    });
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.get(
        Uri.parse(ApiConfig.localPoolSessionActive),
        headers: headers,
      ).timeout(const Duration(seconds: 12));
      final body = jsonDecode(res.body);
      if (res.statusCode == 200) {
        final data = (body['data'] is Map<String, dynamic>) ? body['data'] as Map<String, dynamic> : body;
        final session = data['session'] as Map<String, dynamic>?;
        if (!mounted) return;
        setState(() {
          _session = session;
          _passengers = List<dynamic>.from(data['passengers'] ?? const []);
          _loading = false;
          _error = null;
        });
        if (session != null) {
          _startLocationUpdates();
        } else {
          _locationTimer?.cancel();
        }
      } else {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = body['message']?.toString() ?? 'Failed to load local pool';
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Network issue while loading local pool';
      });
    }
  }

  Future<void> _startSession() async {
    setState(() => _starting = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(ApiConfig.localPoolSessionStart),
        headers: headers,
        body: jsonEncode({'maxSeats': _maxSeats}),
      ).timeout(const Duration(seconds: 12));
      if (res.statusCode == 200) {
        await _load();
      } else {
        final body = jsonDecode(res.body);
        if (!mounted) return;
        // The "Available for Car Share" toggle alone doesn't guarantee pool
        // eligibility — the driver's assigned vehicle_category also has to
        // be admin-flagged as pool-capable. When that's the actual blocker,
        // the raw backend message doesn't tell the driver what to do next,
        // so surface a clearer, actionable explanation for those two codes.
        final code = body['code']?.toString() ?? '';
        final message = (code == 'POOL_DRIVER_NOT_ELIGIBLE' || code == 'POOL_DRIVER_CATEGORY_MISMATCH')
            ? 'Your registered vehicle isn\'t approved for Car Share yet. Contact JAGO support to get your vehicle category enabled for Car Share.'
            : (body['message']?.toString() ?? 'Could not start local pool');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue while starting local pool')),
      );
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _endSession() async {
    setState(() => _ending = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(ApiConfig.localPoolSessionEnd),
        headers: headers,
      ).timeout(const Duration(seconds: 12));
      if (res.statusCode == 200) {
        _locationTimer?.cancel();
        await _load();
      }
    } finally {
      if (mounted) setState(() => _ending = false);
    }
  }

  bool get _acceptingNewPassengers {
    final seatEventValue = _seatState?['acceptingNewRequests'];
    if (seatEventValue is bool) return seatEventValue;
    final camel = _session?['acceptingNewRequests'];
    if (camel is bool) return camel;
    final snake = _session?['accepting_new_requests'];
    if (snake is bool) return snake;
    return true;
  }

  Future<void> _toggleAccepting(bool accepting) async {
    setState(() => _updatingAccepting = true);
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(ApiConfig.localPoolSessionAccepting),
        headers: headers,
        body: jsonEncode({'acceptingNewRequests': accepting}),
      ).timeout(const Duration(seconds: 12));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(body['message']?.toString() ?? (accepting ? 'Accepting new passengers' : 'New passengers paused'))),
      );
      if (res.statusCode == 200) {
        setState(() {
          _seatState = {
            ...?_seatState,
            'acceptingNewRequests': accepting,
          };
          _session = {
            ...?_session,
            'accepting_new_requests': accepting,
            'acceptingNewRequests': accepting,
          };
        });
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue while updating pool mode')),
      );
    } finally {
      if (mounted) setState(() => _updatingAccepting = false);
    }
  }

  // ── Redesigned dynamic-card state derivation ──────────────────────────────

  /// The single passenger the dynamic bottom card should front right now.
  /// Priority: a passenger waiting on Accept/Skip outranks one already
  /// matched, which outranks one already onboard — matching the order a
  /// driver actually needs to act on next. Everyone else stays reachable via
  /// "View All Stops" instead of being hidden.
  Map<String, dynamic>? _focusedPassenger() {
    Map<String, dynamic>? firstWithStatus(String status) {
      for (final p in _passengers) {
        final m = p as Map<String, dynamic>;
        if ((m['status']?.toString() ?? '') == status) return m;
      }
      return null;
    }

    return firstWithStatus('pending_driver_accept') ?? firstWithStatus('matched') ?? firstWithStatus('picked_up');
  }

  PoolCardState _poolCardStateFor(Map<String, dynamic>? focused) {
    switch (focused?['status']?.toString()) {
      case 'pending_driver_accept':
        return PoolCardState.newRequestPending;
      case 'matched':
        return PoolCardState.headingToPickup;
      case 'picked_up':
        return PoolCardState.onboard;
      default:
        if (_passengers.isNotEmpty && _passengers.every((p) => (p as Map<String, dynamic>)['status']?.toString() == 'dropped')) {
          return PoolCardState.allDropped;
        }
        return PoolCardState.idleWaiting;
    }
  }

  (int, int) get _seatCounts {
    final maxSeats = int.tryParse('${_seatState?['maxSeats'] ?? _session?['max_seats'] ?? _maxSeats}') ?? _maxSeats;
    final available = int.tryParse('${_seatState?['availableSeats'] ?? _session?['available_seats'] ?? maxSeats}') ?? maxSeats;
    final occupied = (maxSeats - available).clamp(0, maxSeats);
    return (maxSeats, occupied);
  }

  void _openSeatSheet() {
    final (maxSeats, occupied) = _seatCounts;
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => PoolSeatSheet(maxSeats: maxSeats, occupied: occupied),
    );
  }

  void _openStopsSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => PoolStopsSheet(
        items: _passengers.map((p) => _buildPassengerCard(p as Map<String, dynamic>)).toList(),
      ),
    );
  }

  void _openSafetySheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => PoolSafetySheet(
        onSos: _sendPoolSos,
        onShareFirstRider: _passengers.isNotEmpty ? () => _sharePassenger(_passengers.first as Map<String, dynamic>) : null,
        onEmergencyContact: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const DriverSupportChatScreen()),
        ),
        onReport: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const DriverSupportChatScreen()),
        ),
      ),
    );
  }

  void _maybeShowIncomingRequestModal(Map<String, dynamic> event) {
    final requestId = event['requestId']?.toString() ?? '';
    if (requestId.isEmpty || requestId == _lastPromptedRequestId || !mounted) return;
    _lastPromptedRequestId = requestId;
    final seats = int.tryParse('${event['seatsRequested'] ?? event['seats'] ?? 1}') ?? 1;
    final fare = double.tryParse('${event['totalFare'] ?? 0}') ?? 0;
    final expires = int.tryParse('${event['expiresInSeconds'] ?? 40}') ?? 40;
    PoolIncomingRequestModal.show(
      context,
      passengerName: event['customerName']?.toString() ?? 'Passenger',
      pickupAddress: event['pickupAddress']?.toString() ?? '-',
      dropAddress: event['dropAddress']?.toString() ?? '-',
      seatsRequested: seats,
      totalFare: fare,
      expiresInSeconds: expires,
      onAccept: () {
        _lastPromptedRequestId = null;
        _acceptPassenger(requestId);
      },
      onDecline: () {
        _lastPromptedRequestId = null;
        _skipPassenger(requestId);
      },
    );
  }

  Future<void> _pickupPassenger(String requestId) async {
    _otpCtrl.clear();
    final otp = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Enter Boarding OTP'),
        content: TextField(
          controller: _otpCtrl,
          keyboardType: TextInputType.number,
          maxLength: 4,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: const InputDecoration(hintText: '4-digit OTP'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(context, _otpCtrl.text.trim()), child: const Text('Verify')),
        ],
      ),
    );
    if (otp == null || otp.isEmpty) return;

    await _postSimple(ApiConfig.localPoolPickup(requestId), {'otp': otp});
  }

  Future<void> _dropPassenger(String requestId) async {
    await _postSimple(ApiConfig.localPoolDrop(requestId), const {});
  }

  Future<void> _markNoShow(String requestId) async {
    await _postSimple(ApiConfig.localPoolNoShow(requestId), const {});
  }

  Future<void> _postSimple(String url, Map<String, dynamic> body) async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(
        Uri.parse(url),
        headers: headers,
        body: jsonEncode(body),
      ).timeout(const Duration(seconds: 12));
      final payload = jsonDecode(res.body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(payload['message']?.toString() ?? (res.statusCode == 200 ? 'Updated' : 'Action failed'))),
      );
      if (res.statusCode == 200) {
        await _load();
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue. Please retry.')),
      );
    }
  }

  void _startLocationUpdates() {
    if (_locationTimer != null) return;
    _syncCurrentLocation();
    _locationTimer = Timer.periodic(const Duration(seconds: 8), (_) => _syncCurrentLocation());
  }

  Future<void> _syncCurrentLocation() async {
    if (_session == null) {
      _locationTimer?.cancel();
      _locationTimer = null;
      return;
    }
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(const Duration(seconds: 5));
      final headers = await AuthService.getHeaders();
      await http.patch(
        Uri.parse(ApiConfig.localPoolLocation),
        headers: headers,
        body: jsonEncode({
          'lat': pos.latitude,
          'lng': pos.longitude,
          'bearingDeg': pos.heading.isFinite ? pos.heading : null,
        }),
      ).timeout(const Duration(seconds: 5));
    } catch (_) {
      // Keep local pool UI responsive even if GPS/network pauses briefly.
    }
  }

  Future<void> _sharePassenger(Map<String, dynamic> passenger) async {
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.poolShare),
        headers: headers,
        body: jsonEncode({'module': 'local_pool', 'referenceId': passenger['id']?.toString()}),
      ).timeout(const Duration(seconds: 12));
      final body = jsonDecode(res.body);
      if (res.statusCode == 200) {
        await Clipboard.setData(ClipboardData(text: body['shareText']?.toString() ?? 'JAGO Pool trip'));
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Passenger trip summary copied to clipboard')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not prepare share summary')),
      );
    }
  }

  void _openPassengerChat(Map<String, dynamic> passenger) {
    final requestId = passenger['id']?.toString() ?? '';
    if (requestId.isEmpty) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => TripChatSheet(
        tripId: requestId,
        senderName: 'Driver',
        chatScope: 'pool',
        poolModule: 'local_pool',
        title: 'Passenger Chat',
      ),
    );
  }

  void _startPassengerCall(Map<String, dynamic> passenger) {
    final requestId = passenger['id']?.toString() ?? '';
    final customerId = passenger['customer_id']?.toString() ?? '';
    if (requestId.isEmpty || customerId.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CallScreen(
          contactName: passenger['customer_name']?.toString() ?? 'Passenger',
          tripId: requestId,
          targetUserId: customerId,
          callScope: 'pool',
          poolModule: 'local_pool',
        ),
      ),
    );
  }

  Future<void> _blockPassenger(Map<String, dynamic> passenger) async {
    final blockedUserId = passenger['customer_id']?.toString() ?? '';
    if (blockedUserId.isEmpty) return;
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.poolBlockUser),
        headers: headers,
        body: jsonEncode({
          'blockedUserId': blockedUserId,
          'module': 'local_pool',
          'referenceType': 'request',
          'referenceId': passenger['id']?.toString(),
          'reason': 'Blocked from local pool driver console',
        }),
      ).timeout(const Duration(seconds: 12));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(body['message']?.toString() ?? 'Passenger blocked from future pool matching')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not block passenger right now')),
      );
    }
  }

  Future<void> _sendPoolSos() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Pool SOS'),
        content: const Text('Send emergency alert for this active local pool session?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.pop(context, true), child: const Text('Send SOS')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      final headers = await AuthService.getHeaders();
      await http.post(
        Uri.parse(ApiConfig.sos),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'tripId': _session?['id']?.toString(),
          'lat': _session?['current_lat'],
          'lng': _session?['current_lng'],
          'message': 'Driver SOS alert during local pool session',
        }),
      ).timeout(const Duration(seconds: 12));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pool SOS sent to JAGO safety operations')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('SOS failed. Call emergency services immediately.')),
      );
    }
  }

  Future<void> _loadDriverMarkerIcon() async {
    final icon = await JagoMapMarkers.vehicle(_vehicleCategoryType ?? 'cab');
    if (!mounted) return;
    setState(() => _driverMarkerIcon = icon);
  }

  double? _readDouble(dynamic value) {
    if (value == null) return null;
    final parsed = double.tryParse(value.toString());
    if (parsed == null || parsed == 0) return null;
    return parsed;
  }

  Widget _buildPoolMapHero() {
    final currentLat = _readDouble(_session?['current_lat']);
    final currentLng = _readDouble(_session?['current_lng']);
    final points = <LatLng>[];
    final markers = <Marker>{};

    if (currentLat != null && currentLng != null) {
      final self = LatLng(currentLat, currentLng);
      points.add(self);
      markers.add(
        Marker(
          markerId: const MarkerId('driver'),
          position: self,
          infoWindow: const InfoWindow(title: 'Driver'),
          icon: _driverMarkerIcon ??
              BitmapDescriptor.defaultMarkerWithHue(
                BitmapDescriptor.hueAzure,
              ),
        ),
      );
    }

    for (var i = 0; i < _passengers.length; i++) {
      final p = _passengers[i] as Map<String, dynamic>;
      final pickupLat = _readDouble(p['pickup_lat'] ?? p['pickupLat']);
      final pickupLng = _readDouble(p['pickup_lng'] ?? p['pickupLng']);
      final dropLat = _readDouble(p['drop_lat'] ?? p['dropLat']);
      final dropLng = _readDouble(p['drop_lng'] ?? p['dropLng']);
      final status = p['status']?.toString() ?? '';

      if (pickupLat != null &&
          pickupLng != null &&
          status != 'picked_up' &&
          status != 'dropped') {
        final pickup = LatLng(pickupLat, pickupLng);
        points.add(pickup);
        markers.add(
          Marker(
            markerId: MarkerId('pickup_$i'),
            position: pickup,
            infoWindow: InfoWindow(
              title: 'Pickup ${i + 1}',
              snippet: p['customer_name']?.toString() ?? 'Passenger',
            ),
            icon: BitmapDescriptor.defaultMarkerWithHue(
              BitmapDescriptor.hueGreen,
            ),
          ),
        );
      }

      if (dropLat != null && dropLng != null) {
        final drop = LatLng(dropLat, dropLng);
        points.add(drop);
        markers.add(
          Marker(
            markerId: MarkerId('drop_$i'),
            position: drop,
            infoWindow: InfoWindow(
              title: 'Drop ${i + 1}',
              snippet: p['customer_name']?.toString() ?? 'Passenger',
            ),
            icon: BitmapDescriptor.defaultMarkerWithHue(
              BitmapDescriptor.hueRed,
            ),
          ),
        );
      }
    }

    final center = points.isNotEmpty ? points.first : const LatLng(17.3850, 78.4867);
    final polyline = points.length >= 2
        ? {
            Polyline(
              polylineId: const PolylineId('pool_route'),
              points: points,
              color: JT.primary,
              width: 5,
              startCap: Cap.roundCap,
              endCap: Cap.roundCap,
            ),
          }
        : <Polyline>{};

    final (maxSeats, occupied) = _seatCounts;

    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: Stack(
        children: [
          Positioned.fill(
            child: GoogleMap(
              initialCameraPosition: CameraPosition(target: center, zoom: 13.2),
              markers: markers,
              polylines: polyline,
              myLocationEnabled: false,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              mapToolbarEnabled: false,
              compassEnabled: false,
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            top: 16,
            child: PoolStatusFloatingCard(
              ridersCount: _passengers.length,
              accepting: _acceptingNewPassengers,
              updatingAccepting: _updatingAccepting,
              onToggleAccepting: _updatingAccepting ? null : _toggleAccepting,
              maxSeats: maxSeats,
              occupiedSeats: occupied,
              onSeatTap: _openSeatSheet,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bg,
      appBar: AppBar(
        backgroundColor: JT.bg,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: JT.textPrimary),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text('Local Pool', style: GoogleFonts.poppins(fontSize: 17, fontWeight: FontWeight.w600, color: JT.textPrimary)),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded, color: JT.primary), onPressed: _load),
          const SizedBox(width: 4),
        ],
      ),
      body: _loading
          ? _buildLoadingState()
          : _error != null
              ? _buildError()
              : _session == null
                  ? RefreshIndicator(
                      onRefresh: _load,
                      color: JT.primary,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                        children: [_buildStarter()],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: JT.primary,
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          // Deliberate map:sheet split (map gets ~60%) rather
                          // than the old incidental "whatever's left after a
                          // fixed 350-380px sheet" sizing.
                          final mapHeight = (constraints.maxHeight * 0.60)
                              .clamp(200.0, constraints.maxHeight);
                          final sheetMaxHeight =
                              (constraints.maxHeight - mapHeight).clamp(180.0, 460.0);
                          final focused = _focusedPassenger();
                          final (maxSeats, occupied) = _seatCounts;
                          final available = (maxSeats - occupied).clamp(0, maxSeats);
                          return DraggableMapSheet(
                            map: ListView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              children: [
                                SizedBox(
                                  height: constraints.maxHeight,
                                  child: _buildPoolMapHero(),
                                ),
                              ],
                            ),
                            floatingControls: _buildSafetyPill(),
                            floatingControlsBottom: sheetMaxHeight + 16,
                            maxHeight: sheetMaxHeight,
                            sheetRadius: 24,
                            sheetShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.12),
                                blurRadius: 24,
                                offset: const Offset(0, -8),
                              ),
                            ],
                            bodyPadding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                            wrapBodyInSafeArea: false,
                            sheetBody: Column(
                              children: [
                                const SheetHandle(),
                                const SizedBox(height: 12),
                                PoolDynamicActionCard(
                                  state: _poolCardStateFor(focused),
                                  availableSeats: available,
                                  maxSeats: maxSeats,
                                  ending: _ending,
                                  onEndSession: _ending ? null : _endSession,
                                  focusedPassengerCard:
                                      focused != null ? _buildPassengerCard(focused) : null,
                                  stopsCount: _passengers.length,
                                  onViewAllStops: _passengers.isEmpty ? null : _openStopsSheet,
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
    );
  }

  // Small always-reachable floating safety pill, mirroring TripScreen's
  // `_mapControlButton` convention — replaces the old permanently-visible
  // "Pool Safety & Share" card.
  Widget _buildSafetyPill() {
    return GestureDetector(
      onTap: _openSafetySheet,
      child: Container(
        width: 52,
        height: 52,
        decoration: BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.14), blurRadius: 14, offset: const Offset(0, 6)),
          ],
        ),
        child: const Icon(Icons.shield_rounded, color: JT.error, size: 24),
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_rounded, size: 52, color: JT.textSecondary),
          const SizedBox(height: 12),
          Text(_error!, style: GoogleFonts.poppins(color: JT.textSecondary)),
        ],
      ),
    );
  }

  Widget _buildCarShareToggleCard() {
    return Container(
      padding: const EdgeInsets.all(18),
      margin: const EdgeInsets.only(bottom: 16),
      decoration: AppCard.light(radius: 20),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Available for Car Share?', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 15, color: JT.textPrimary)),
                const SizedBox(height: 4),
                Text(
                  'A persistent setting for your registered vehicle — required before you can start Local Pool Mode below.',
                  style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          _loadingCarShareFlag
              ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: JT.primary))
              : Switch(
                  value: _carShareEnabled,
                  activeThumbColor: JT.primary,
                  onChanged: _updatingCarShareFlag ? null : _setCarShareEnabled,
                ),
        ],
      ),
    );
  }

  Widget _buildStarter() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildCarShareToggleCard(),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: AppCard.light(radius: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Start Local Pool Mode', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 18, color: JT.textPrimary)),
              const SizedBox(height: 8),
              Text('Go live for shared city rides. Passengers will be clustered by direction and live seat availability.', style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary)),
              if (!_loadingCarShareFlag && !_carShareEnabled) ...[
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFF7ED),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFFED7AA)),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline_rounded, color: Color(0xFFC2410C), size: 18),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Turn on "Available for Car Share?" above first.',
                          style: GoogleFonts.poppins(fontSize: 12.5, color: const Color(0xFFC2410C), fontWeight: FontWeight.w500),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 18),
              Text('Seats', style: GoogleFonts.poppins(fontWeight: FontWeight.w500)),
              const SizedBox(height: 8),
              Builder(builder: (context) {
                // Only offer seat counts the driver's actual registered
                // vehicle can fulfill; fall back to the full range if the
                // vehicle's capacity isn't known yet.
                final options = [3, 4, 5, 6]
                    .where((e) => _vehicleTotalSeats == null || e <= _vehicleTotalSeats!)
                    .toList();
                final safeOptions = options.isEmpty ? const [3, 4, 5, 6] : options;
                final value = safeOptions.contains(_maxSeats) ? _maxSeats : safeOptions.first;
                return DropdownButtonFormField<int>(
                  initialValue: value,
                  decoration: InputDecoration(
                    filled: true,
                    fillColor: JT.surface,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
                  ),
                  items: safeOptions.map((e) => DropdownMenuItem(value: e, child: Text('$e seats'))).toList(),
                  onChanged: _carShareEnabled ? (v) => setState(() => _maxSeats = v ?? safeOptions.first) : null,
                );
              }),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity,
                child: AppButton.neonGradient(
                  label: 'Start Local Pool',
                  onTap: (_starting || !_carShareEnabled) ? () {} : _startSession,
                  loading: _starting,
                  height: 56,
                  radius: 16,
                  neonColor: !_carShareEnabled ? JT.border : JT.primary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _acceptPassenger(String requestId) async {
    await _postSimple(ApiConfig.localPoolAcceptPassenger(requestId), const {});
  }

  Future<void> _skipPassenger(String requestId) async {
    await _postSimple(ApiConfig.localPoolSkipPassenger(requestId), const {});
  }

  Widget _buildPassengerCard(Map<String, dynamic> p) {
    final status = p['status']?.toString() ?? 'matched';
    final requestId = p['id']?.toString() ?? '';
    final safety = p['safety'] is Map<String, dynamic> ? p['safety'] as Map<String, dynamic> : null;
    final safetyLabel = safety?['badgeLabel']?.toString();
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: AppCard.light(radius: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                    gradient: JT.grad,
                    borderRadius: BorderRadius.circular(15),
                    boxShadow: JT.btnShadow),
                child: Center(
                  child: Text(
                    (p['customer_name']?.toString().isNotEmpty == true) ? p['customer_name'].toString()[0].toUpperCase() : 'P',
                    style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w500),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(p['customer_name']?.toString() ?? 'Passenger', style: AppText.bodyPrimary(context)),
                        ),
                        if (safetyLabel != null) _userSafetyBadge(safetyLabel),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text('${p['seats_requested'] ?? 1} seat(s) · ₹${double.tryParse('${p['total_fare'] ?? 0}')?.toStringAsFixed(0) ?? '0'}', style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
                  ],
                ),
              ),
              _statusBadge(status),
            ],
          ),
          const SizedBox(height: 12),
          Text('Pickup: ${p['pickup_address'] ?? '-'}', style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
          const SizedBox(height: 4),
          Text('Drop: ${p['drop_address'] ?? '-'}', style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
          const SizedBox(height: 14),
          Row(
            children: [
              if (status == 'pending_driver_accept') ...[
                Expanded(
                  child: OutlinedButton(
                    onPressed: requestId.isEmpty ? null : () => _skipPassenger(requestId),
                    style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                    child: Text('Skip', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    onPressed: requestId.isEmpty ? null : () => _acceptPassenger(requestId),
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF16A34A), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                    child: Text('Accept', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
                  ),
                ),
              ] else if (status == 'matched') ...[
                Expanded(
                  child: OutlinedButton(
                    onPressed: requestId.isEmpty ? null : () => _markNoShow(requestId),
                    style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                    child: Text('No-show', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    onPressed: requestId.isEmpty ? null : () => _pickupPassenger(requestId),
                    style: ElevatedButton.styleFrom(backgroundColor: JT.primary, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                    child: Text('Verify OTP', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
                  ),
                ),
              ] else if (status == 'picked_up') ...[
                Expanded(
                  child: ElevatedButton(
                    onPressed: requestId.isEmpty ? null : () => _dropPassenger(requestId),
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF16A34A), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                    child: Text('Drop Passenger', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
                  ),
                ),
              ] else if (status == 'dropped') ...[
                Expanded(
                  child: ElevatedButton(
                    onPressed: requestId.isEmpty ? null : () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => _LocalPassengerRatingScreen(
                          requestId: requestId,
                          passengerName: p['customer_name']?.toString() ?? 'Passenger',
                        ),
                      ),
                    ),
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFF59E0B), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                    child: Text('Rate Passenger', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              OutlinedButton.icon(
                onPressed: requestId.isEmpty ? null : () => _openPassengerChat(p),
                style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16),
                label: Text('Chat', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12)),
              ),
              OutlinedButton.icon(
                onPressed: (p['customer_id']?.toString().isEmpty ?? true) ? null : () => _startPassengerCall(p),
                style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                icon: const Icon(Icons.call_rounded, size: 16),
                label: Text('Call', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12)),
              ),
              OutlinedButton.icon(
                onPressed: requestId.isEmpty ? null : () => _sharePassenger(p),
                style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                icon: const Icon(Icons.share_outlined, size: 16),
                label: Text('Share', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12)),
              ),
              OutlinedButton.icon(
                onPressed: (p['customer_id']?.toString().isEmpty ?? true) ? null : () => _blockPassenger(p),
                style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                icon: const Icon(Icons.block_outlined, size: 16),
                label: Text('Block', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12)),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statusBadge(String status) {
    Color color;
    switch (status) {
      case 'pending_driver_accept':
        color = const Color(0xFFF97316);
        break;
      case 'picked_up':
        color = const Color(0xFF16A34A);
        break;
      case 'matched':
        color = JT.primary;
        break;
      default:
        color = const Color(0xFF6B7280);
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.20)),
      ),
      child: Text(
        status.replaceAll('_', ' '),
        style: GoogleFonts.poppins(fontSize: 11, fontWeight: FontWeight.w600, color: color),
      ),
    );
  }
}

Widget _userSafetyBadge(String label) {
  final color = label == 'Blocked User'
      ? JT.error
      : label == 'High Risk User'
          ? JT.warning
          : JT.primary;
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: color.withValues(alpha: 0.2)),
    ),
    child: Text(
      label,
      style: GoogleFonts.poppins(fontSize: 11, fontWeight: FontWeight.w600, color: color),
    ),
  );
}


class _LocalPassengerRatingScreen extends StatefulWidget {
  final String requestId;
  final String passengerName;

  const _LocalPassengerRatingScreen({
    required this.requestId,
    required this.passengerName,
  });

  @override
  State<_LocalPassengerRatingScreen> createState() => _LocalPassengerRatingScreenState();
}

class _LocalPassengerRatingScreenState extends State<_LocalPassengerRatingScreen> {
  final _noteCtrl = TextEditingController();
  final Map<String, int> _ratings = {
    'Safety': 5,
    'Behaviour': 5,
    'Punctuality': 5,
    'Overall': 5,
  };
  bool _loading = false;

  @override
  void dispose() {
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading) return;
    setState(() => _loading = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.localPoolRatePassenger(widget.requestId)),
        headers: headers,
        body: jsonEncode({
          'overallRating': _ratings['Overall'],
          'safetyRating': _ratings['Safety'],
          'behaviourRating': _ratings['Behaviour'],
          'punctualityRating': _ratings['Punctuality'],
          'note': _noteCtrl.text.trim(),
        }),
      ).timeout(const Duration(seconds: 15));
      final body = jsonDecode(res.body);
      if (!mounted) return;
      if (res.statusCode == 200) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Passenger rating submitted')));
        Navigator.pop(context, body);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(body['message']?.toString() ?? 'Could not submit rating')));
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Network issue while submitting rating')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        title: Text('Rate Passenger', style: JT.h4),
      ),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: JT.border),
              boxShadow: JT.cardShadow,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.passengerName, style: JT.h4),
                const SizedBox(height: 6),
                Text('Driver-side passenger rating is saved only once after trip completion.', style: JT.body),
                const SizedBox(height: 16),
                ..._ratings.keys.map((label) => Padding(
                  padding: const EdgeInsets.only(bottom: 14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(label, style: JT.bodyPrimary),
                      const SizedBox(height: 8),
                      Row(
                        children: List.generate(5, (index) {
                          final star = index + 1;
                          return IconButton(
                            onPressed: () => setState(() => _ratings[label] = star),
                            padding: EdgeInsets.zero,
                            visualDensity: VisualDensity.compact,
                            icon: Icon(
                              star <= (_ratings[label] ?? 5) ? Icons.star_rounded : Icons.star_outline_rounded,
                              color: JT.warning,
                            ),
                          );
                        }),
                      ),
                    ],
                  ),
                )),
                TextField(
                  controller: _noteCtrl,
                  minLines: 3,
                  maxLines: 4,
                  decoration: InputDecoration(
                    hintText: 'Add optional notes',
                    filled: true,
                    fillColor: JT.surfaceAlt,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: JT.border)),
                    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: BorderSide(color: JT.border)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          JT.gradientButton(label: _loading ? 'Submitting...' : 'Submit Rating', onTap: _submit, loading: _loading),
        ],
      ),
    );
  }
}
