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
import '../../widgets/pool/pool_seat_selector_strip.dart';
import '../../widgets/pool/pool_slide_to_confirm.dart';
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

  // Which seat card the driver has explicitly tapped — null means "no
  // explicit choice yet, follow _focusedPassenger() automatically". See
  // _resolveSelectedIndex.
  int? _selectedSeatIndex;
  GoogleMapController? _mapController;
  // Draggable bottom sheet height (fraction of screen height) — mirrors
  // TripScreen's identical _panelHeightFraction mechanic so both driver
  // screens drag the same way.
  double? _sheetHeightFraction;

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

  // ── Seat-slot derivation ───────────────────────────────────────────────────
  //
  // There is no backend "seat number" concept (pool_ride_requests only ever
  // tracked an aggregate maxSeats/availableSeats count) — the seat cards are
  // a purely client-side visual grouping of the existing passenger list into
  // maxSeats slots, in list order, each passenger consuming seatsRequested
  // consecutive slots. Nothing here changes what the server considers a
  // "seat"; it only changes how the same data is laid out on screen.

  /// The single passenger the bottom sheet should front by default — same
  /// priority TripScreen/the old dynamic card used: a passenger waiting on
  /// Accept/Skip outranks one already matched, which outranks one already
  /// onboard, matching the order a driver actually needs to act on next.
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

  (int, int) get _seatCounts {
    final maxSeats = int.tryParse('${_seatState?['maxSeats'] ?? _session?['max_seats'] ?? _maxSeats}') ?? _maxSeats;
    final available = int.tryParse('${_seatState?['availableSeats'] ?? _session?['available_seats'] ?? maxSeats}') ?? maxSeats;
    final occupied = (maxSeats - available).clamp(0, maxSeats);
    return (maxSeats, occupied);
  }

  static const _activeSeatStatuses = {'pending_driver_accept', 'matched', 'picked_up'};

  List<PoolSeatSlot> _seatSlots() {
    final (maxSeats, _) = _seatCounts;
    final slots = List<PoolSeatSlot>.filled(maxSeats, const PoolSeatSlot(null));
    var idx = 0;
    for (final p in _passengers) {
      if (idx >= maxSeats) break;
      final m = p as Map<String, dynamic>;
      if (!_activeSeatStatuses.contains(m['status']?.toString() ?? '')) continue;
      final seatsReq = (int.tryParse('${m['seats_requested'] ?? 1}') ?? 1).clamp(1, maxSeats);
      for (var i = 0; i < seatsReq && idx < maxSeats; i++, idx++) {
        slots[idx] = PoolSeatSlot(m);
      }
    }
    return slots;
  }

  /// Resolves the seat index actually shown as selected: the driver's own
  /// tap if it still points at an occupied seat, otherwise falls back to
  /// [_focusedPassenger]'s slot (auto-selected) so the sheet is never left
  /// pointing at nothing while a passenger is in progress.
  int _resolveSelectedIndex(List<PoolSeatSlot> slots) {
    final explicit = _selectedSeatIndex;
    if (explicit != null && explicit >= 0 && explicit < slots.length && !slots[explicit].isEmpty) {
      return explicit;
    }
    final focused = _focusedPassenger();
    if (focused != null) {
      final id = focused['id']?.toString();
      final i = slots.indexWhere((s) => s.passenger?['id']?.toString() == id);
      if (i != -1) return i;
    }
    return slots.indexWhere((s) => !s.isEmpty);
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
      builder: (_) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        insetPadding: const EdgeInsets.symmetric(horizontal: 28),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: JT.primary.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.lock_rounded, color: JT.primary, size: 24),
              ),
              const SizedBox(height: 16),
              Text('Enter Boarding OTP',
                  style: GoogleFonts.poppins(fontSize: 17, fontWeight: FontWeight.w700, color: JT.textPrimary)),
              const SizedBox(height: 6),
              Text('Ask the passenger for the 4-digit secure PIN shown on their app.',
                  style: GoogleFonts.poppins(fontSize: 12.5, color: JT.textSecondary)),
              const SizedBox(height: 20),
              TextField(
                controller: _otpCtrl,
                autofocus: true,
                keyboardType: TextInputType.number,
                maxLength: 4,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                style: GoogleFonts.poppins(fontSize: 22, fontWeight: FontWeight.w700, letterSpacing: 6),
                textAlign: TextAlign.center,
                decoration: InputDecoration(
                  counterText: '',
                  hintText: '••••',
                  hintStyle: GoogleFonts.poppins(fontSize: 22, color: JT.textSecondary, letterSpacing: 6),
                  filled: true,
                  fillColor: JT.bgSoft,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: JT.primary, width: 1.5),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        side: const BorderSide(color: JT.border),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text('Cancel',
                          style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: JT.textPrimary)),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () => Navigator.pop(context, _otpCtrl.text.trim()),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: JT.primary,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                      child: Text('Verify',
                          style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: Colors.white)),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
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

  Future<void> _recenterOnDriver() async {
    final lat = _readDouble(_session?['current_lat']);
    final lng = _readDouble(_session?['current_lng']);
    if (lat == null || lng == null || _mapController == null) return;
    await _mapController!.animateCamera(CameraUpdate.newLatLngZoom(LatLng(lat, lng), 15));
  }

  /// [selectedPassengerId] — the one passenger (see _resolveSelectedIndex)
  /// whose pickup/drop/route should stand out; every other passenger still
  /// gets a marker (so the driver keeps the full picture) but in a muted
  /// color, and the route line is drawn only for the selected stop instead
  /// of chaining every passenger's points into one cluttered polyline.
  Widget _buildPoolMapHero(String? selectedPassengerId) {
    final currentLat = _readDouble(_session?['current_lat']);
    final currentLng = _readDouble(_session?['current_lng']);
    LatLng? driverPos;
    final markers = <Marker>{};
    LatLng? selectedPickup;
    LatLng? selectedDrop;
    var selectedStatus = '';

    if (currentLat != null && currentLng != null) {
      driverPos = LatLng(currentLat, currentLng);
      markers.add(
        Marker(
          markerId: const MarkerId('driver'),
          position: driverPos,
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
      final isSelected = selectedPassengerId != null && p['id']?.toString() == selectedPassengerId;

      if (pickupLat != null &&
          pickupLng != null &&
          status != 'picked_up' &&
          status != 'dropped') {
        final pickup = LatLng(pickupLat, pickupLng);
        markers.add(
          Marker(
            markerId: MarkerId('pickup_$i'),
            position: pickup,
            infoWindow: InfoWindow(
              title: 'Pickup ${i + 1}',
              snippet: p['customer_name']?.toString() ?? 'Passenger',
            ),
            icon: BitmapDescriptor.defaultMarkerWithHue(
              isSelected ? BitmapDescriptor.hueGreen : BitmapDescriptor.hueViolet,
            ),
            zIndexInt: isSelected ? 2 : 1,
          ),
        );
        if (isSelected) selectedPickup = pickup;
      }

      if (dropLat != null && dropLng != null) {
        final drop = LatLng(dropLat, dropLng);
        markers.add(
          Marker(
            markerId: MarkerId('drop_$i'),
            position: drop,
            infoWindow: InfoWindow(
              title: 'Drop ${i + 1}',
              snippet: p['customer_name']?.toString() ?? 'Passenger',
            ),
            icon: BitmapDescriptor.defaultMarkerWithHue(
              isSelected ? BitmapDescriptor.hueRed : BitmapDescriptor.hueOrange,
            ),
            zIndexInt: isSelected ? 2 : 1,
          ),
        );
        if (isSelected) {
          selectedDrop = drop;
          selectedStatus = status;
        }
      }
    }

    final routePoints = <LatLng>[
      if (driverPos != null) driverPos,
      if (selectedStatus != 'picked_up' && selectedPickup != null) selectedPickup,
      if (selectedDrop != null) selectedDrop,
    ];
    final polyline = routePoints.length >= 2
        ? {
            Polyline(
              polylineId: const PolylineId('pool_route'),
              points: routePoints,
              color: JT.primary,
              width: 5,
              startCap: Cap.roundCap,
              endCap: Cap.roundCap,
            ),
          }
        : <Polyline>{};

    final center = driverPos ?? selectedPickup ?? selectedDrop ?? const LatLng(17.3850, 78.4867);

    // No rounding here — this hero fills the entire body edge-to-edge (see
    // DraggableMapSheet's Positioned.fill), so a rounded-rect clip on all
    // four corners just exposed the Scaffold's background color in each
    // corner instead of giving a true full-screen map.
    return Stack(
      children: [
        Positioned.fill(
          child: GoogleMap(
            initialCameraPosition: CameraPosition(target: center, zoom: 13.2),
            onMapCreated: (c) => _mapController = c,
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
          top: 16,
          right: 16,
          child: GestureDetector(
            onTap: _recenterOnDriver,
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(color: Colors.black.withValues(alpha: 0.12), blurRadius: 12, offset: const Offset(0, 4)),
                ],
              ),
              child: const Icon(Icons.my_location_rounded, color: JT.primary, size: 20),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _error != null || _session == null) {
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
                : RefreshIndicator(
                    onRefresh: _load,
                    color: JT.primary,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                      children: [_buildStarter()],
                    ),
                  ),
      );
    }

    // ── Active session: compact header + seat strip + ~60/40 map/sheet ──────
    final slots = _seatSlots();
    final selectedIndex = _resolveSelectedIndex(slots);
    final selected = selectedIndex >= 0 ? slots[selectedIndex].passenger : null;
    final status = selected?['status']?.toString() ?? '';

    return Scaffold(
      backgroundColor: JT.bg,
      body: Column(
        children: [
          SafeArea(bottom: false, child: _buildActiveHeader()),
          const SizedBox(height: 12),
          SizedBox(height: 62, child: PoolSeatSelectorStrip(
            slots: slots,
            selectedIndex: selectedIndex,
            onSeatTap: (i) => setState(() => _selectedSeatIndex = i),
          )),
          const SizedBox(height: 12),
          Expanded(
            child: DraggableMapSheet(
              map: _buildPoolMapHero(selected?['id']?.toString()),
              floatingControls: _buildSafetyPill(),
              // The sheet's height is a fraction of the *full* screen height
              // (see heightFraction below — same convention DraggableMapSheet
              // uses for TripScreen), not of this Expanded's own smaller
              // constraints, so the floating pill's clearance has to be
              // computed off that same full-screen fraction or it renders
              // underneath the (opaque, painted-after-it) sheet.
              floatingControlsBottom: MediaQuery.of(context).size.height * (_sheetHeightFraction ?? 0.40) + 16,
              handle: const SheetHandle(),
              onHandleDragUpdate: (details) {
                final screenH = MediaQuery.of(context).size.height;
                setState(() {
                  _sheetHeightFraction =
                      ((_sheetHeightFraction ?? 0.40) - details.delta.dy / screenH).clamp(0.22, 0.72);
                });
              },
              heightFraction: _sheetHeightFraction ?? 0.40,
              sheetRadius: 24,
              sheetShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.12),
                  blurRadius: 24,
                  offset: const Offset(0, -8),
                ),
              ],
              bodyPadding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
              sheetBody: _buildSheetContent(selected, status, selectedIndex, slots.length),
            ),
          ),
        ],
      ),
    );
  }

  // ── Compact header (active session) ───────────────────────────────────────
  //
  // Replaces the old AppBar + floating map card: back/title row, then a
  // status row ("Carpool active" + occupancy chip + settings gear) that
  // folds in what used to be a card floated over the map (accepting
  // toggle, seat strip) plus the old bare refresh action — all still
  // reachable, just relocated into _openPoolSettingsSheet so the map stays
  // uncluttered.
  Widget _buildActiveHeader() {
    final (maxSeats, occupied) = _seatCounts;
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 4, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: JT.textPrimary),
                onPressed: () => Navigator.pop(context),
              ),
              Text('Local Pool', style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700, color: JT.textPrimary)),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.settings_outlined, color: JT.textSecondary),
                onPressed: _openPoolSettingsSheet,
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 48),
            child: Row(
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(color: JT.success, shape: BoxShape.circle),
                ),
                const SizedBox(width: 6),
                Text('Carpool active',
                    style: GoogleFonts.poppins(fontSize: 13.5, fontWeight: FontWeight.w600, color: JT.textPrimary)),
                const SizedBox(width: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: JT.bgSoft,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '$maxSeats seats · $occupied occupied',
                    style: GoogleFonts.poppins(fontSize: 11.5, fontWeight: FontWeight.w500, color: JT.textSecondary),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _openPoolSettingsSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (sheetContext) => StatefulBuilder(builder: (sheetContext, setSheetState) {
        // No active passenger at all — session can be ended safely. Mirrors
        // the old PoolDynamicActionCard's gating (End Pool only ever showed
        // for idleWaiting/allDropped, never mid-passenger).
        final canEnd = _focusedPassenger() == null;
        return SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(child: SheetHandle(color: JT.border)),
                const SizedBox(height: 18),
                Text('Local Pool Settings', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600, color: JT.textPrimary)),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Accepting new passengers', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 13.5, color: JT.textPrimary)),
                          const SizedBox(height: 2),
                          Text('Pause to stop new match requests without ending your session.', style: GoogleFonts.poppins(fontSize: 11.5, color: JT.textSecondary)),
                        ],
                      ),
                    ),
                    _updatingAccepting
                        ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: JT.primary))
                        : Switch(
                            value: _acceptingNewPassengers,
                            activeThumbColor: JT.primary,
                            onChanged: (v) async {
                              await _toggleAccepting(v);
                              setSheetState(() {});
                            },
                          ),
                  ],
                ),
                const SizedBox(height: 8),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.refresh_rounded, color: JT.primary),
                  title: Text('Refresh', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: JT.textPrimary)),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _load();
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  enabled: canEnd && !_ending,
                  leading: Icon(Icons.stop_circle_outlined, color: canEnd ? JT.error : JT.textSecondary.withValues(alpha: 0.4)),
                  title: Text(
                    _ending ? 'Ending...' : 'End Pool Session',
                    style: GoogleFonts.poppins(
                      fontWeight: FontWeight.w600,
                      color: canEnd ? JT.error : JT.textSecondary.withValues(alpha: 0.4),
                    ),
                  ),
                  subtitle: canEnd ? null : Text('Finish or drop the current passenger first', style: GoogleFonts.poppins(fontSize: 11.5, color: JT.textSecondary)),
                  onTap: (!canEnd || _ending)
                      ? null
                      : () {
                          Navigator.pop(sheetContext);
                          _endSession();
                        },
                ),
              ],
            ),
          ),
        );
      }),
    );
  }

  // ── Bottom sheet content (active session) ─────────────────────────────────

  Widget _buildSheetContent(Map<String, dynamic>? selected, String status, int selectedIndex, int maxSeats) {
    if (selected == null) {
      return _buildIdleOrAllDroppedContent();
    }
    final requestId = selected['id']?.toString() ?? '';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        _buildPassengerHeaderRow(selected, selectedIndex, maxSeats),
        const SizedBox(height: 16),
        _buildTripDetailsCard(selected),
        const SizedBox(height: 12),
        _buildDistanceEtaRow(selected, status),
        const SizedBox(height: 18),
        _buildPrimaryAction(selected, status, requestId),
        if (_passengers.length > 1) ...[
          const SizedBox(height: 12),
          Center(
            child: TextButton(
              onPressed: _openStopsSheet,
              child: Text(
                'View All Stops (${_passengers.length})',
                style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w600, color: JT.primary),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildIdleOrAllDroppedContent() {
    final allDropped = _passengers.isNotEmpty &&
        _passengers.every((p) => (p as Map<String, dynamic>)['status']?.toString() == 'dropped');
    final (maxSeats, occupied) = _seatCounts;
    final available = (maxSeats - occupied).clamp(0, maxSeats);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: (allDropped ? JT.success : JT.primary).withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                allDropped ? Icons.task_alt_rounded : Icons.hourglass_top_rounded,
                color: allDropped ? JT.success : JT.primary,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    allDropped ? 'All riders dropped' : 'Waiting for passengers',
                    style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: JT.textPrimary),
                  ),
                  Text(
                    allDropped
                        ? 'Rate your passengers from View All Stops, then end the session.'
                        : '$available of $maxSeats seats available. Matching is live.',
                    style: GoogleFonts.poppins(fontSize: 11.5, color: JT.textSecondary),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (allDropped) ...[
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _ending ? null : _endSession,
              style: ElevatedButton.styleFrom(
                backgroundColor: JT.primary,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: Text(_ending ? 'Ending...' : 'End Session', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
        if (_passengers.isNotEmpty) ...[
          const SizedBox(height: 10),
          Center(
            child: TextButton(
              onPressed: _openStopsSheet,
              child: Text(
                'View All Stops (${_passengers.length})',
                style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w600, color: JT.primary),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildPassengerHeaderRow(Map<String, dynamic> p, int selectedIndex, int maxSeats) {
    final name = p['customer_name']?.toString() ?? 'Passenger';
    final fare = double.tryParse('${p['total_fare'] ?? 0}')?.toStringAsFixed(0) ?? '0';
    final phone = p['customer_phone']?.toString() ?? '';
    return Row(
      children: [
        Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(gradient: JT.grad, borderRadius: BorderRadius.circular(14), boxShadow: JT.btnShadow),
          child: Center(
            child: Text(
              name.isNotEmpty ? name[0].toUpperCase() : 'P',
              style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w600),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: GoogleFonts.poppins(fontSize: 15.5, fontWeight: FontWeight.w700, color: JT.textPrimary)),
              Text('Seat ${selectedIndex + 1} of $maxSeats · ₹$fare', style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
            ],
          ),
        ),
        const SizedBox(width: 8),
        _circleActionBtn(
          icon: Icons.call_rounded,
          color: JT.primary,
          enabled: phone.isNotEmpty || (p['customer_id']?.toString().isNotEmpty ?? false),
          onTap: () => _startPassengerCall(p),
        ),
        const SizedBox(width: 8),
        _circleActionBtn(
          icon: Icons.chat_bubble_outline_rounded,
          color: JT.primary,
          enabled: true,
          onTap: () => _openPassengerChat(p),
        ),
        const SizedBox(width: 8),
        _buildMoreMenuButton(p),
      ],
    );
  }

  Widget _circleActionBtn({
    required IconData icon,
    required Color color,
    required bool enabled,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: enabled ? onTap : null,
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: color.withValues(alpha: enabled ? 0.10 : 0.05),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: enabled ? color : color.withValues(alpha: 0.35), size: 18),
      ),
    );
  }

  // "More" — folds in every secondary passenger action that used to sit in
  // the old always-visible Chat/Call/Share/Block row plus the driver's only
  // pre-pickup "remove this passenger" affordance. There's no dedicated
  // driver-side "cancel booking" endpoint distinct from skip/no-show, so
  // "Cancel Booking" reuses whichever of those already applies to the
  // passenger's current status — same call, clearer label.
  Widget _buildMoreMenuButton(Map<String, dynamic> p) {
    final status = p['status']?.toString() ?? '';
    final requestId = p['id']?.toString() ?? '';
    final canCancel = status == 'pending_driver_accept' || status == 'matched';
    final canBlock = p['customer_id']?.toString().isNotEmpty ?? false;
    return PopupMenuButton<String>(
      tooltip: '',
      offset: const Offset(0, 46),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      onSelected: (value) {
        switch (value) {
          case 'cancel':
            _confirmCancelBooking(p, status, requestId);
            break;
          case 'share':
            _sharePassenger(p);
            break;
          case 'block':
            _blockPassenger(p);
            break;
          case 'report':
          case 'support':
            Navigator.of(context).push(MaterialPageRoute(builder: (_) => const DriverSupportChatScreen()));
            break;
        }
      },
      itemBuilder: (context) => [
        if (canCancel) PopupMenuItem(value: 'cancel', child: _menuRow(Icons.cancel_rounded, 'Cancel Booking', JT.error)),
        PopupMenuItem(value: 'share', child: _menuRow(Icons.share_outlined, 'Share Trip', JT.primary)),
        if (canBlock) PopupMenuItem(value: 'block', child: _menuRow(Icons.block_outlined, 'Block Passenger', JT.error)),
        PopupMenuItem(value: 'report', child: _menuRow(Icons.report_gmailerrorred_rounded, 'Report Issue', JT.primary)),
        PopupMenuItem(value: 'support', child: _menuRow(Icons.headset_mic_rounded, 'Support', JT.primary)),
      ],
      child: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: JT.textSecondary.withValues(alpha: 0.08), shape: BoxShape.circle),
        child: const Icon(Icons.more_horiz_rounded, color: JT.textSecondary, size: 20),
      ),
    );
  }

  Widget _menuRow(IconData icon, String label, Color color) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, color: color, size: 18),
      const SizedBox(width: 10),
      Text(label, style: GoogleFonts.poppins(color: color, fontWeight: FontWeight.w600, fontSize: 14)),
    ]);
  }

  Future<void> _confirmCancelBooking(Map<String, dynamic> p, String status, String requestId) async {
    if (requestId.isEmpty) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Cancel booking?'),
        content: Text('This removes ${p['customer_name']?.toString() ?? 'the passenger'} from your route and frees their seat.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: JT.error),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cancel Booking'),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    if (status == 'pending_driver_accept') {
      await _skipPassenger(requestId);
    } else {
      await _markNoShow(requestId);
    }
  }

  Widget _buildTripDetailsCard(Map<String, dynamic> p) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JT.bgSoft,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _addressRow(Icons.my_location_rounded, JT.primary, 'Pickup', p['pickup_address']?.toString() ?? '-'),
          Padding(
            padding: const EdgeInsets.only(left: 11),
            child: SizedBox(height: 16, child: VerticalDivider(width: 2, thickness: 2, color: JT.border)),
          ),
          _addressRow(Icons.location_on_rounded, JT.error, 'Drop', p['drop_address']?.toString() ?? '-'),
        ],
      ),
    );
  }

  Widget _addressRow(IconData icon, Color color, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: GoogleFonts.poppins(fontSize: 10.5, fontWeight: FontWeight.w600, color: JT.textSecondary)),
              Text(value, maxLines: 2, overflow: TextOverflow.ellipsis, style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w500, color: JT.textPrimary)),
            ],
          ),
        ),
      ],
    );
  }

  String _formatDistLocal(double meters) {
    if (meters < 1000) return '${meters.round()} m';
    return '${(meters / 1000).toStringAsFixed(1)} km';
  }

  Widget _buildDistanceEtaRow(Map<String, dynamic> p, String status) {
    final driverLat = _readDouble(_session?['current_lat']);
    final driverLng = _readDouble(_session?['current_lng']);
    final headingToDrop = status == 'picked_up';
    final targetLat = _readDouble(headingToDrop ? (p['drop_lat'] ?? p['dropLat']) : (p['pickup_lat'] ?? p['pickupLat']));
    final targetLng = _readDouble(headingToDrop ? (p['drop_lng'] ?? p['dropLng']) : (p['pickup_lng'] ?? p['pickupLng']));
    double? meters;
    if (driverLat != null && driverLng != null && targetLat != null && targetLng != null) {
      meters = Geolocator.distanceBetween(driverLat, driverLng, targetLat, targetLng);
    }
    // Simple constant-speed estimate (~25 km/h city average) — this screen
    // has no turn-by-turn routing/Directions integration, unlike TripScreen's
    // nav mode, so this mirrors the same lightweight approximation used
    // elsewhere rather than calling a new routing endpoint.
    final etaMin = meters != null ? (meters / 1000 / 25 * 60).ceil().clamp(1, 999) : null;
    final label = headingToDrop ? 'to drop' : 'to pickup';
    return Row(
      children: [
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(color: JT.bgSoft, borderRadius: BorderRadius.circular(14)),
            child: Row(children: [
              const Icon(Icons.near_me_rounded, color: JT.primary, size: 16),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(meters != null ? _formatDistLocal(meters) : '--', style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w700, color: JT.textPrimary)),
                  Text(label, style: GoogleFonts.poppins(fontSize: 10.5, color: JT.textSecondary)),
                ],
              ),
            ]),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(color: JT.bgSoft, borderRadius: BorderRadius.circular(14)),
            child: Row(children: [
              const Icon(Icons.schedule_rounded, color: JT.primary, size: 16),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(etaMin != null ? '$etaMin min' : '--', style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w700, color: JT.textPrimary)),
                  Text('estimated time', style: GoogleFonts.poppins(fontSize: 10.5, color: JT.textSecondary)),
                ],
              ),
            ]),
          ),
        ),
      ],
    );
  }

  Widget _buildPrimaryAction(Map<String, dynamic> p, String status, String requestId) {
    switch (status) {
      case 'pending_driver_accept':
        return Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: requestId.isEmpty ? null : () => _skipPassenger(requestId),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  side: const BorderSide(color: JT.border),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: Text('Skip', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: JT.textPrimary)),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: ElevatedButton(
                onPressed: requestId.isEmpty ? null : () => _acceptPassenger(requestId),
                style: ElevatedButton.styleFrom(
                  backgroundColor: JT.success,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: Text('Accept', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
              ),
            ),
          ],
        );
      case 'matched':
        return Column(
          children: [
            PoolSlideToConfirm(
              key: ValueKey('arrive-$requestId'),
              label: 'Slide to mark as arrived',
              icon: Icons.arrow_forward_rounded,
              color: JT.primary,
              onConfirmed: () => _pickupPassenger(requestId),
            ),
            const SizedBox(height: 6),
            Text('Arrive at pickup location once you reach', style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary)),
          ],
        );
      case 'picked_up':
        return PoolSlideToConfirm(
          key: ValueKey('drop-$requestId'),
          label: 'Slide to drop passenger',
          icon: Icons.flag_rounded,
          color: JT.success,
          onConfirmed: () => _dropPassenger(requestId),
        );
      default:
        return const SizedBox.shrink();
    }
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
