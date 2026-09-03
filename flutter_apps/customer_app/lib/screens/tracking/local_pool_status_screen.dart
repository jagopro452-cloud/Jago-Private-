import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import '../../core/map_night_style.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import 'package:jago_shared_core/jago_shared_core.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import '../call/call_screen.dart';
import '../chat/trip_chat_sheet.dart';
import 'pool_experience_screens.dart';

class LocalPoolStatusScreen extends StatefulWidget {
  final String requestId;
  final String pickupAddress;
  final String dropAddress;
  // Only needed to power "Try Again" after a search timeout — null on old
  // call sites (none currently) just disables that one button, nothing else.
  final double? pickupLat;
  final double? pickupLng;
  final double? dropLat;
  final double? dropLng;

  const LocalPoolStatusScreen({
    super.key,
    required this.requestId,
    required this.pickupAddress,
    required this.dropAddress,
    this.pickupLat,
    this.pickupLng,
    this.dropLat,
    this.dropLng,
  });

  @override
  State<LocalPoolStatusScreen> createState() => _LocalPoolStatusScreenState();
}

class _LocalPoolStatusScreenState extends State<LocalPoolStatusScreen>
    with SingleTickerProviderStateMixin {
  final SocketService _socket = SocketService();
  Timer? _poller;
  // Searching-screen animation, matching the Bike/Auto tracking screen's
  // "Finding you the best ride" pulse + 3-step tracker so Car Share's first
  // moments feel like the same product, not a different flow bolted on.
  late final AnimationController _pulseCtrl;
  Timer? _searchStageTimer;
  int _searchStage = 0; // cycles 0..2: Searching -> Verifying -> Matching
  StreamSubscription<Map<String, dynamic>>? _poolStatusSub;
  StreamSubscription<Map<String, dynamic>>? _seatSub;
  StreamSubscription<Map<String, dynamic>>? _callIncomingSub;
  StreamSubscription<Map<String, dynamic>>? _driverLocationSub;
  StreamSubscription<Map<String, dynamic>>? _refundUpdateSub;
  StreamSubscription<Map<String, dynamic>>? _safetyUpdateSub;

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

  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 44,
            height: 44,
            child: CircularProgressIndicator(color: JT.primary, strokeWidth: 2.5),
          ),
          const SizedBox(height: 14),
          Text(
            'Syncing your shared ride...',
            style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary),
          ),
        ],
      ),
    );
  }

  bool _loading = true;
  bool _cancelling = false;
  bool _retrying = false;
  String? _error;
  Map<String, dynamic>? _booking;
  Map<String, dynamic>? _seatState;
  String _status = 'searching';
  LatLng? _driverLatLng;
  Set<Marker> _liveMapMarkers = {};

  // The matched vehicle isn't known until a driver is assigned — before
  // that there's nothing meaningful to show, so JagoMapMarkers falls back
  // to its generic "cab" icon via the empty string.
  String _matchedVehicleLabel() {
    return (_booking?['vehicle_category_type'] ??
            _booking?['vehicle_category_name'] ??
            _booking?['driver']?['vehicleCategoryType'] ??
            _booking?['driver']?['vehicleCategoryName'] ??
            '')
        .toString();
  }

  Future<void> _updateLiveMapMarkers() async {
    final pickupLat = double.tryParse('${_booking?['pickup_lat'] ?? ''}');
    final pickupLng = double.tryParse('${_booking?['pickup_lng'] ?? ''}');
    final dropLat = double.tryParse('${_booking?['drop_lat'] ?? ''}');
    final dropLng = double.tryParse('${_booking?['drop_lng'] ?? ''}');
    final pickup = (pickupLat != null && pickupLng != null) ? LatLng(pickupLat, pickupLng) : null;
    final drop = (dropLat != null && dropLng != null) ? LatLng(dropLat, dropLng) : null;

    final markers = <Marker>{
      if (pickup != null)
        Marker(
          markerId: const MarkerId('pickup'),
          position: pickup,
          infoWindow: const InfoWindow(title: 'Pickup'),
          icon: await JagoMapMarkers.pickup(),
        ),
      if (drop != null)
        Marker(
          markerId: const MarkerId('drop'),
          position: drop,
          infoWindow: const InfoWindow(title: 'Drop'),
          icon: await JagoMapMarkers.destination(),
        ),
      if (_driverLatLng != null)
        Marker(
          markerId: const MarkerId('driver'),
          position: _driverLatLng!,
          infoWindow: const InfoWindow(title: 'Driver'),
          icon: await JagoMapMarkers.vehicle(_matchedVehicleLabel()),
        ),
    };
    if (!mounted) return;
    setState(() => _liveMapMarkers = markers);
  }

  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();
    _startSearchStageLoop();
    _wireSocket();
    _load();
    _poller = Timer.periodic(const Duration(seconds: 8), (_) => _load(silent: true));
  }

  // Purely cosmetic loop that cycles the "Searching / Verifying / Matching"
  // step indicator while a pooled driver is being found — mirrors
  // TrackingScreen's identical loop for the normal Bike/Auto search screen.
  void _startSearchStageLoop() {
    _searchStageTimer?.cancel();
    _searchStage = 0;
    _searchStageTimer = Timer.periodic(const Duration(milliseconds: 1800), (_) {
      if (!mounted || _status != 'searching') return;
      setState(() => _searchStage = (_searchStage + 1) % 3);
    });
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _searchStageTimer?.cancel();
    _poller?.cancel();
    _poolStatusSub?.cancel();
    _seatSub?.cancel();
    _callIncomingSub?.cancel();
    _driverLocationSub?.cancel();
    _refundUpdateSub?.cancel();
    _safetyUpdateSub?.cancel();
    super.dispose();
  }

  void _wireSocket() {
    _poolStatusSub = _socket.onPoolStatus.listen((event) {
      final eventRequestId = event['requestId']?.toString() ?? '';
      if (eventRequestId.isNotEmpty && eventRequestId != widget.requestId) return;
      if (!mounted) return;
      // Once the customer has cancelled locally, no later event — a driver
      // match that was already in flight, a stale re-send, etc. — is allowed
      // to pull this screen back out of 'cancelled'. The backend enforces
      // the same rule authoritatively (matchRequest() re-checks status
      // before assigning a driver); this is the client-side mirror of that
      // guarantee so the UI can't visibly flicker back to "searching" either.
      if (_status == 'cancelled') return;
      setState(() {
        _status = event['status']?.toString() ?? _status;
        if (_booking != null) {
          if (_status == 'pending_driver_accept') {
            _booking = {
              ..._booking!,
              'status': 'pending_driver_accept',
              if (event['driver'] != null) 'driver': event['driver'],
            };
          } else if (_status == 'matched') {
            _booking = {
              ..._booking!,
              'status': 'matched',
              if (event['driver'] != null) 'driver': event['driver'],
            };
          } else if (_status == 'picked_up') {
            _booking = {..._booking!, 'status': 'picked_up'};
          } else if (_status == 'dropped') {
            _booking = {..._booking!, 'status': 'dropped'};
          } else if (_status == 'searching') {
            // driver_skipped or driver_confirm_timeout — back to searching, clear stale driver data
            _booking = {..._booking!, 'status': 'searching'};
          } else if (_status == 'cancelled' || _status == 'search_timeout') {
            _booking = {..._booking!, 'status': 'cancelled'};
            _error = event['reason']?.toString() ?? event['message']?.toString();
          }
        }
      });
      _updateLiveMapMarkers();
    });

    _seatSub = _socket.onPoolSeatUpdate.listen((event) {
      if (!mounted) return;
      setState(() => _seatState = event);
    });
    _driverLocationSub = _socket.onPoolDriverLocation.listen((event) {
      if ((event['module']?.toString() ?? '') != 'local_pool') return;
      final lat = double.tryParse('${event['lat'] ?? ''}');
      final lng = double.tryParse('${event['lng'] ?? ''}');
      if (lat == null || lng == null || !mounted) return;
      setState(() {
        _driverLatLng = LatLng(lat, lng);
      });
      _updateLiveMapMarkers();
    });
    _callIncomingSub = _socket.onCallIncoming.listen((event) {
      final scope = event['callScope']?.toString();
      final poolModule = event['poolModule']?.toString();
      final referenceId = event['tripId']?.toString() ?? '';
      if (scope != 'pool' || poolModule != 'local_pool' || referenceId != widget.requestId || !mounted) return;
      final callerId = event['callerId']?.toString() ?? '';
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CallScreen(
            contactName: event['callerName']?.toString() ?? 'Driver',
            tripId: widget.requestId,
            targetUserId: callerId,
            isIncoming: true,
            callerIdForIncoming: callerId,
            callScope: 'pool',
            poolModule: 'local_pool',
          ),
        ),
      );
    });
    _refundUpdateSub = _socket.onPoolRefundUpdated.listen((event) {
      final module = event['module']?.toString() ?? '';
      final referenceId = event['referenceId']?.toString() ?? '';
      if (module != 'local_pool' || referenceId != widget.requestId || !mounted) return;
      _load(silent: true);
    });
    _safetyUpdateSub = _socket.onPoolSafetyUpdated.listen((event) {
      final module = event['module']?.toString() ?? '';
      final referenceId = event['referenceId']?.toString() ?? '';
      if (module != 'local_pool' || referenceId != widget.requestId || !mounted) return;
      _load(silent: true);
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
        Uri.parse(ApiConfig.localPoolStatus(widget.requestId)),
        headers: headers,
      ).timeout(const Duration(seconds: 12));

      final body = jsonDecode(res.body);
      if (res.statusCode == 200) {
        final data = (body['data'] is Map<String, dynamic>) ? body['data'] as Map<String, dynamic> : body;
        final booking = (data['booking'] is Map<String, dynamic>) ? data['booking'] as Map<String, dynamic> : <String, dynamic>{};
        if (!mounted) return;
        setState(() {
          _booking = booking;
          _status = booking['status']?.toString() ?? _status;
          final lat = double.tryParse('${booking['driver_lat'] ?? booking['driverLat'] ?? ''}');
          final lng = double.tryParse('${booking['driver_lng'] ?? booking['driverLng'] ?? ''}');
          if (lat != null && lng != null) {
            _driverLatLng = LatLng(lat, lng);
          }
          _loading = false;
          _error = null;
        });
        _updateLiveMapMarkers();
      } else {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = body['message']?.toString() ?? 'Could not load pool ride';
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Network issue while loading your pool ride.';
      });
    }
  }

  // Lightweight cancel used only while still 'searching' — no driver is
  // involved yet, so there's nothing to explain a reason to and no refund
  // policy applies. Fixes the "can't cancel while searching" issue: the
  // full PoolCancellationScreen (reason + refund policy) stays reserved for
  // cancelling an already-matched ride below.
  Future<void> _cancelSearch() async {
    if (_cancelling) return;
    setState(() => _cancelling = true);
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.localPoolCancel(widget.requestId)),
        headers: headers,
        body: jsonEncode({'reason': 'Customer cancelled while searching'}),
      ).timeout(const Duration(seconds: 15));
      if (!mounted) return;
      if (res.statusCode == 200) {
        // Stop watching this request immediately — no further socket event
        // or poll response (including a driver match already in flight) can
        // move this screen off 'cancelled' from here on.
        _poller?.cancel();
        _poolStatusSub?.cancel();
        _seatSub?.cancel();
        _driverLocationSub?.cancel();
        setState(() => _status = 'cancelled');
        Navigator.of(context).popUntil((route) => route.isFirst);
        return;
      }
      final body = jsonDecode(res.body);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(body['message']?.toString() ?? 'Could not cancel search. Try again.')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue while cancelling search')),
      );
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  // Re-books the same pickup/drop/seat count as a brand new request after a
  // search timeout closed this one — same POST CarShareOptionsScreen makes,
  // just re-issued here so the customer doesn't have to re-enter anything.
  // Replaces this screen with a fresh one (requestId is a different pool
  // booking now) rather than mutating in place.
  Future<void> _tryAgain() async {
    if (_retrying) return;
    if (widget.pickupLat == null || widget.pickupLng == null || widget.dropLat == null || widget.dropLng == null) {
      // No coordinates to rebook with (older call site) — send them back to
      // pick pickup/drop again rather than failing silently.
      Navigator.of(context).popUntil((route) => route.isFirst);
      return;
    }
    setState(() => _retrying = true);
    try {
      final seats = int.tryParse('${_booking?['seats_requested'] ?? _booking?['seatsRequested'] ?? 1}') ?? 1;
      final headers = await AuthService.getHeaders();
      final res = await http
          .post(
            Uri.parse(ApiConfig.localPoolBook),
            headers: headers,
            body: jsonEncode({
              'pickupLat': widget.pickupLat,
              'pickupLng': widget.pickupLng,
              'dropLat': widget.dropLat,
              'dropLng': widget.dropLng,
              'pickupAddress': widget.pickupAddress,
              'dropAddress': widget.dropAddress,
              'seatsRequested': seats,
            }),
          )
          .timeout(const Duration(seconds: 20));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final newRequestId = data['data']?['requestId']?.toString();
      if (!mounted) return;
      if (res.statusCode == 200 && data['success'] == true && newRequestId != null) {
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => LocalPoolStatusScreen(
              requestId: newRequestId,
              pickupAddress: widget.pickupAddress,
              dropAddress: widget.dropAddress,
              pickupLat: widget.pickupLat,
              pickupLng: widget.pickupLng,
              dropLat: widget.dropLat,
              dropLng: widget.dropLng,
            ),
          ),
        );
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(data['message']?.toString() ?? 'Could not start a new search'),
        backgroundColor: JT.error,
      ));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue while starting a new search')),
      );
    } finally {
      if (mounted) setState(() => _retrying = false);
    }
  }

  Future<void> _openCancellationFlow() async {
    final fare = double.tryParse('${_booking?['total_fare'] ?? _booking?['totalFare'] ?? 0}') ?? 0;
    final seats = int.tryParse('${_booking?['seats_requested'] ?? _booking?['seatsRequested'] ?? 1}') ?? 1;
    final result = await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PoolCancellationScreen(
          title: 'Cancel Pool Booking',
          bookingId: widget.requestId,
          isOutstation: false,
          routeLabel: '${widget.pickupAddress} -> ${widget.dropAddress}',
          seatsBooked: seats,
          totalFare: fare,
        ),
      ),
    );
    if (result is Map && mounted) {
      setState(() {
        _status = 'cancelled';
        _booking = {
          ...?_booking,
          'status': 'cancelled',
          'refundAmount': result['refundAmount'],
        };
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(result['message']?.toString() ?? 'Pool booking cancelled')),
      );
    }
  }

  void _openPoolChat() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => TripChatSheet(
        tripId: widget.requestId,
        senderName: 'Customer',
        chatScope: 'pool',
        poolModule: 'local_pool',
        title: 'Pool Chat',
      ),
    );
  }

  void _startPoolCall() {
    final driverId = _booking?['driver_id']?.toString() ?? _booking?['driverId']?.toString() ?? '';
    final driverName = _booking?['driver_name']?.toString() ?? _booking?['driver']?['name']?.toString() ?? 'Driver';
    if (driverId.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Driver call is not available right now')),
      );
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CallScreen(
          contactName: driverName,
          tripId: widget.requestId,
          targetUserId: driverId,
          callScope: 'pool',
          poolModule: 'local_pool',
        ),
      ),
    );
  }

  String get _statusTitle {
    switch (_status) {
      case 'pending_driver_accept':
        return 'Driver found — confirming';
      case 'matched':
        return 'Driver matched';
      case 'picked_up':
        return 'On the way';
      case 'dropped':
        return 'Ride completed';
      case 'cancelled':
        return 'Booking closed';
      case 'search_timeout':
        return 'No pool driver found';
      default:
        return 'Searching nearby pooled driver';
    }
  }

  String get _statusSubtitle {
    switch (_status) {
      case 'pending_driver_accept':
        return 'A driver has been found. Waiting for them to confirm your seat — this takes just a moment.';
      case 'matched':
        return 'Your pooled ride is confirmed. Reach pickup point and share OTP only after driver arrives.';
      case 'picked_up':
        return 'You are onboard. Live seat state and pooled occupancy are syncing.';
      case 'dropped':
        return 'This pooled ride is completed.';
      case 'cancelled':
        return _error ?? 'This pooled ride is cancelled.';
      case 'search_timeout':
        return 'No compatible pooled driver was found in time. Try regular ride or retry pool.';
      default:
        return 'We are clustering your route with active local pool drivers.';
    }
  }

  Widget _poolProgressCard() {
    final states = <String>[
      'searching',
      'pending_driver_accept',
      'matched',
      'picked_up',
      'dropped',
    ];
    final labels = <String, String>{
      'searching': 'Searching',
      'pending_driver_accept': 'Confirming',
      'matched': 'Driver matched',
      'picked_up': 'Onboard',
      'dropped': 'Completed',
    };
    final activeIndex = states.indexOf(_status).clamp(0, states.length - 1);

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Journey Progress',
            style: GoogleFonts.poppins(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: JT.textPrimary,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: List.generate(states.length, (index) {
              final done = index <= activeIndex;
              return Expanded(
                child: Row(
                  children: [
                    Expanded(
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 250),
                        height: 6,
                        decoration: BoxDecoration(
                          color: done ? JT.primary : JT.border,
                          borderRadius: BorderRadius.circular(999),
                        ),
                      ),
                    ),
                    if (index < states.length - 1) const SizedBox(width: 6),
                  ],
                ),
              );
            }),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: states.map((state) {
              final idx = states.indexOf(state);
              final done = idx <= activeIndex;
              return Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: done
                      ? JT.primary.withValues(alpha: 0.08)
                      : JT.bgSoft,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: done
                        ? JT.primary.withValues(alpha: 0.16)
                        : JT.border,
                  ),
                ),
                child: Text(
                  labels[state] ?? state,
                  style: GoogleFonts.poppins(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: done ? JT.primary : JT.textSecondary,
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _stopSequenceCard() {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Ride Sequence',
            style: GoogleFonts.poppins(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: JT.textPrimary,
            ),
          ),
          const SizedBox(height: 12),
          _sequenceNode(
            index: 1,
            title: 'Pickup point',
            subtitle: widget.pickupAddress,
            active: _status != 'dropped',
          ),
          const SizedBox(height: 10),
          _sequenceNode(
            index: 2,
            title: 'Boarding OTP',
            subtitle: _status == 'matched' || _status == 'picked_up' || _status == 'dropped'
                ? 'Share OTP only after the pool driver reaches you.'
                : 'OTP unlocks after the driver confirms your seat.',
            active: _status == 'matched' || _status == 'picked_up' || _status == 'dropped',
          ),
          const SizedBox(height: 10),
          _sequenceNode(
            index: 3,
            title: 'Drop point',
            subtitle: widget.dropAddress,
            active: _status == 'picked_up' || _status == 'dropped',
          ),
        ],
      ),
    );
  }

  Widget _sequenceNode({
    required int index,
    required String title,
    required String subtitle,
    required bool active,
  }) {
    final color = active ? JT.primary : JT.textSecondary;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: active ? JT.primary.withValues(alpha: 0.10) : JT.bgSoft,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Center(
            child: Text(
              '$index',
              style: GoogleFonts.poppins(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: GoogleFonts.poppins(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: JT.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: GoogleFonts.poppins(
                  fontSize: 12,
                  color: JT.textSecondary,
                  height: 1.45,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final driver = _booking?['driver'] is Map<String, dynamic>
        ? _booking!['driver'] as Map<String, dynamic>
        : null;
    final fare = double.tryParse('${_booking?['total_fare'] ?? _booking?['totalFare'] ?? 0}') ?? 0;
    final seats = int.tryParse('${_booking?['seats_requested'] ?? _booking?['seatsRequested'] ?? 1}') ?? 1;
    final otp = _booking?['boarding_otp']?.toString() ?? _booking?['boardingOtp']?.toString() ?? '----';

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: JT.textPrimary),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Local Pool Ride',
          style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: JT.textPrimary, fontSize: 17),
        ),
      ),
      body: _loading
          ? _buildLoadingState()
          : RefreshIndicator(
              onRefresh: _load,
              color: JT.primary,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final sheetMaxHeight =
                      constraints.maxHeight > 780 ? 360.0 : 330.0;
                  return Stack(
                    children: [
                      Positioned.fill(
                        child: ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: [
                            SizedBox(
                              height: constraints.maxHeight,
                              child: _liveMapCard(),
                            ),
                          ],
                        ),
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
                            padding:
                                const EdgeInsets.fromLTRB(16, 12, 16, 24),
                            child: Column(
                              children: [
                                _buildSheetHandle(),
                                const SizedBox(height: 12),
                                if (_status == 'searching')
                                  _buildSearchingHero()
                                else
                                  _headerCard(),
                                const SizedBox(height: 14),
                                // The animated searching hero above already
                                // covers this moment on its own — showing
                                // the 5-stage journey timeline at the same
                                // time is redundant clutter before a driver
                                // even exists yet.
                                if (_status != 'searching') ...[
                                  _poolProgressCard(),
                                  const SizedBox(height: 14),
                                ],
                                _stopSequenceCard(),
                                const SizedBox(height: 14),
                                _seatOverviewCard(seats, fare),
                                const SizedBox(height: 14),
                                _otpCard(otp),
                                if (driver != null) ...[
                                  const SizedBox(height: 14),
                                  _driverCard(driver),
                                ],
                                const SizedBox(height: 14),
                                _routeCard(),
                                if (_error != null &&
                                    _status != 'cancelled' &&
                                    _status != 'search_timeout') ...[
                                  const SizedBox(height: 14),
                                  _errorCard(),
                                ],
                                if (_status == 'matched' ||
                                    _status == 'picked_up' ||
                                    _status == 'dropped') ...[
                                  const SizedBox(height: 14),
                                  _poolActionsCard(),
                                ],
                                const SizedBox(height: 18),
                                if (_status == 'searching' ||
                                    _status == 'pending_driver_accept' ||
                                    _status == 'matched')
                                  SizedBox(
                                    height: 56,
                                    child: ElevatedButton(
                                      onPressed: _cancelling
                                          ? null
                                          : (_status == 'searching' ? _cancelSearch : _openCancellationFlow),
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: Colors.white,
                                        foregroundColor: Colors.red.shade600,
                                        elevation: 0,
                                        side: BorderSide(
                                          color: Colors.red.shade200,
                                        ),
                                        shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(16),
                                        ),
                                      ),
                                      child: Text(
                                        _cancelling
                                            ? 'Cancelling...'
                                            : (_status == 'searching' ? 'Cancel Search' : 'Cancel Pool Booking'),
                                        style: GoogleFonts.poppins(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ),
                                if (_status == 'search_timeout')
                                  SizedBox(
                                    height: 56,
                                    child: ElevatedButton(
                                      onPressed: _retrying ? null : _tryAgain,
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: JT.primary,
                                        foregroundColor: Colors.white,
                                        elevation: 0,
                                        shape: RoundedRectangleBorder(
                                          borderRadius: BorderRadius.circular(16),
                                        ),
                                      ),
                                      child: _retrying
                                          ? const SizedBox(
                                              width: 22,
                                              height: 22,
                                              child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                                            )
                                          : Text(
                                              'Try Again',
                                              style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
                                            ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
    );
  }

  Widget _headerCard() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF2D8CFF), Color(0xFF1E6BE6)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(22),
        boxShadow: [BoxShadow(color: JT.primary.withValues(alpha: 0.24), blurRadius: 20, offset: const Offset(0, 8))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(_statusTitle, style: GoogleFonts.poppins(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Text(_statusSubtitle, style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.92), fontSize: 13)),
        ],
      ),
    );
  }

  // Same "actively searching" moment as the Bike/Auto tracking screen —
  // pulsing radar icon, a live pill, and a 3-step Searching/Verifying/
  // Matching tracker — reskinned for a pooled ride instead of a private one.
  Widget _buildSearchingHero() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: JT.border),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 12, offset: const Offset(0, 4))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildSearchPulseIcon(),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Finding your Car Share pilot',
                      style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w700, color: JT.textPrimary, height: 1.15),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      "We're matching you with a nearby pooled driver heading your way.",
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.poppins(fontSize: 10.5, color: JT.textSecondary, height: 1.25),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _buildSearchLivePill(),
          const SizedBox(height: 10),
          _buildSearchStages(),
        ],
      ),
    );
  }

  Widget _buildSearchPulseIcon() {
    return SizedBox(
      width: 36,
      height: 36,
      child: AnimatedBuilder(
        animation: _pulseCtrl,
        builder: (context, child) {
          final t = _pulseCtrl.value;
          return Stack(
            alignment: Alignment.center,
            children: [
              Transform.scale(
                scale: 1 + t * 0.6,
                child: Opacity(
                  opacity: (1 - t).clamp(0.0, 1.0) * 0.35,
                  child: Container(
                    width: 32,
                    height: 32,
                    decoration: const BoxDecoration(color: JT.primary, shape: BoxShape.circle),
                  ),
                ),
              ),
              child!,
            ],
          );
        },
        child: Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(color: JT.primary.withValues(alpha: 0.12), shape: BoxShape.circle),
          child: const Icon(Icons.search_rounded, color: JT.primary, size: 16),
        ),
      ),
    );
  }

  Widget _buildSearchLivePill() {
    final seats = int.tryParse('${_booking?['seats_requested'] ?? _booking?['seatsRequested'] ?? 1}') ?? 1;
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: JT.success.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedBuilder(
                animation: _pulseCtrl,
                builder: (context, child) => Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: JT.success.withValues(alpha: 0.5 + _pulseCtrl.value * 0.5),
                    shape: BoxShape.circle,
                  ),
                ),
              ),
              const SizedBox(width: 5),
              Text('Live', style: GoogleFonts.poppins(fontSize: 11, fontWeight: FontWeight.w700, color: JT.success)),
              const SizedBox(width: 5),
              Text('|', style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFFCBD5E1))),
              const SizedBox(width: 5),
              Text(
                '$seats ${seats == 1 ? 'seat' : 'seats'} requested',
                style: GoogleFonts.poppins(fontSize: 11, fontWeight: FontWeight.w500, color: JT.textSecondary),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSearchStages() {
    final steps = <(IconData, String)>[
      (Icons.groups_rounded, 'Searching\nnearby drivers'),
      (Icons.verified_user_rounded, 'Verifying\navailability'),
      (Icons.task_alt_rounded, 'Matching\nyour seat'),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: JT.bgSoft,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: JT.borderLight),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < steps.length; i++) ...[
            _buildSearchStageStep(steps[i].$1, steps[i].$2, active: i == _searchStage, done: i < _searchStage),
            if (i != steps.length - 1) Expanded(child: _buildSearchStageConnector(i < _searchStage)),
          ],
        ],
      ),
    );
  }

  Widget _buildSearchStageStep(IconData icon, String label, {required bool active, required bool done}) {
    final color = done ? JT.success : (active ? JT.primary : const Color(0xFF9CA3AF));
    final bg = done
        ? JT.success.withValues(alpha: 0.12)
        : (active ? JT.primary.withValues(alpha: 0.12) : const Color(0xFFE5E7EB).withValues(alpha: 0.5));
    return SizedBox(
      width: 58,
      child: Column(
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            width: active ? 28 : 23,
            height: active ? 28 : 23,
            decoration: BoxDecoration(
              color: bg,
              shape: BoxShape.circle,
              border: active ? Border.all(color: color, width: 1.3) : null,
            ),
            child: Icon(done ? Icons.check_rounded : icon, size: active ? 14 : 11, color: color),
          ),
          const SizedBox(height: 5),
          Text(
            label,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              fontSize: 8.5,
              fontWeight: active ? FontWeight.w600 : FontWeight.w500,
              color: active || done ? JT.textPrimary : const Color(0xFF9CA3AF),
              height: 1.15,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchStageConnector(bool done) {
    return Container(
      margin: const EdgeInsets.only(top: 11, left: 2, right: 2),
      height: 2,
      decoration: BoxDecoration(
        color: done ? JT.success.withValues(alpha: 0.5) : const Color(0xFFE5E7EB),
        borderRadius: BorderRadius.circular(1),
      ),
    );
  }

  Widget _routeCard() {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _locationRow(Icons.my_location_rounded, 'Pickup', widget.pickupAddress),
          const Padding(
            padding: EdgeInsets.only(left: 11, top: 2, bottom: 2),
            child: SizedBox(height: 18, child: VerticalDivider(width: 2, thickness: 2, color: Color(0xFFE2E8F0))),
          ),
          _locationRow(Icons.location_on_rounded, 'Drop', widget.dropAddress),
        ],
      ),
    );
  }

  // ignore: unused_element
  Widget _seatCard(int seats, double fare) {
    return _card(
      child: Row(
        children: [
          Expanded(child: _metric('Booked Seats', '$seats')),
          Expanded(child: _metric('Total Fare', '₹${fare.toStringAsFixed(0)}')),
          Expanded(child: _metric('Live Seats', '${_seatState?['availableSeats'] ?? '-'}')),
        ],
      ),
    );
  }

  Widget _liveMapCard() {
    final pickupLat = double.tryParse('${_booking?['pickup_lat'] ?? ''}');
    final pickupLng = double.tryParse('${_booking?['pickup_lng'] ?? ''}');
    final dropLat = double.tryParse('${_booking?['drop_lat'] ?? ''}');
    final dropLng = double.tryParse('${_booking?['drop_lng'] ?? ''}');
    final pickup = (pickupLat != null && pickupLng != null) ? LatLng(pickupLat, pickupLng) : null;
    final drop = (dropLat != null && dropLng != null) ? LatLng(dropLat, dropLng) : null;
    final center = _driverLatLng ?? pickup ?? drop;

    if (center == null) {
      return _card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Live Movement', style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: JT.textPrimary)),
            const SizedBox(height: 8),
            Text('Driver live map will appear once GPS coordinates start syncing.', style: GoogleFonts.poppins(fontSize: 12.5, color: JT.textSecondary)),
          ],
        ),
      );
    }

    // Markers are built asynchronously via _updateLiveMapMarkers (called from
    // _load/socket handlers whenever booking/driver-location data changes) so
    // they show the actual matched vehicle's icon (JagoMapMarkers.vehicle),
    // not a generic colored pin.
    final markers = _liveMapMarkers;

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Live Movement', style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: JT.textPrimary)),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(18),
            child: SizedBox(
              height: 190,
              child: GoogleMap(
                initialCameraPosition: CameraPosition(target: center, zoom: 14),
                style: Theme.of(context).brightness == Brightness.dark ? kMapNightStyle : null,
                markers: markers,
                myLocationEnabled: false,
                myLocationButtonEnabled: false,
                zoomControlsEnabled: false,
                compassEnabled: false,
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            _driverLatLng == null
                ? 'Waiting for driver GPS update.'
                : 'Driver position is syncing live for this pool ride.',
            style: GoogleFonts.poppins(fontSize: 12.5, color: JT.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _poolActionsCard() {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Pool Actions', style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: JT.textPrimary)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _miniAction(
                icon: Icons.chat_bubble_outline_rounded,
                label: 'Chat Driver',
                onTap: _openPoolChat,
              ),
              if (_status == 'matched' || _status == 'picked_up')
                _miniAction(
                  icon: Icons.call_rounded,
                  label: 'Call Driver',
                  onTap: _startPoolCall,
                ),
              _miniAction(
                icon: Icons.people_alt_rounded,
                label: 'Co-Passengers',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CoPassengerScreen(
                      title: 'Co-Passengers',
                      referenceId: widget.requestId,
                      isOutstation: false,
                    ),
                  ),
                ),
              ),
              _miniAction(
                icon: Icons.report_gmailerrorred_rounded,
                label: 'Report Issue',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => ReportIssueScreen(
                      referenceId: widget.requestId,
                      module: 'local_pool',
                      referenceType: 'request',
                      title: 'Report Pool Issue',
                    ),
                  ),
                ),
              ),
              _miniAction(
                icon: Icons.support_agent_rounded,
                label: 'Support',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => PoolSupportScreen(
                      module: 'local_pool',
                      referenceId: widget.requestId,
                      title: 'Pool Support',
                    ),
                  ),
                ),
              ),
              _miniAction(
                icon: Icons.shield_outlined,
                label: 'Safety',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => PoolSafetyScreen(
                      title: 'Pool Safety',
                      module: 'local_pool',
                      referenceId: widget.requestId,
                      tripId: widget.requestId,
                      driverName: _booking?['driver_name']?.toString() ?? '',
                      vehicleInfo: '${_booking?['vehicle_model'] ?? ''} ${_booking?['vehicle_number'] ?? ''}'.trim(),
                      liveStatus: _status,
                      blockedUserId: _booking?['driver_id']?.toString(),
                    ),
                  ),
                ),
              ),
              _miniAction(
                icon: Icons.timeline_rounded,
                label: 'Dispute',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => PoolDisputeTimelineScreen(
                      title: 'Dispute Timeline',
                      module: 'local_pool',
                      referenceId: widget.requestId,
                    ),
                  ),
                ),
              ),
              if (_status == 'dropped')
                _miniAction(
                  icon: Icons.star_rounded,
                  label: 'Rate Driver',
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => PoolRatingScreen(
                        title: 'Rate Pool Driver',
                        referenceId: widget.requestId,
                        isOutstation: false,
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

  Widget _miniAction({required IconData icon, required String label, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Ink(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: JT.surfaceAlt,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: JT.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: JT.primary, size: 18),
            const SizedBox(width: 8),
            Text(label, style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w600, color: JT.textPrimary)),
          ],
        ),
      ),
    );
  }

  Widget _otpCard(String otp) {
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Boarding OTP', style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary, fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          Text(otp, style: GoogleFonts.poppins(fontSize: 30, fontWeight: FontWeight.w700, color: JT.primary, letterSpacing: 8)),
          const SizedBox(height: 6),
          Text('Share this only when the driver reaches your pickup point.', style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
        ],
      ),
    );
  }

  Widget _driverCard(Map<String, dynamic> driver) {
    final safety = _booking?['driverSafety'] is Map<String, dynamic>
        ? _booking!['driverSafety'] as Map<String, dynamic>
        : null;
    final safetyLabel = safety?['badgeLabel']?.toString();
    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Assigned Driver', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: JT.textPrimary)),
          const SizedBox(height: 10),
          Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: JT.primary.withValues(alpha: 0.1),
                child: Text(
                  (driver['name']?.toString().isNotEmpty == true) ? driver['name'].toString()[0].toUpperCase() : 'D',
                  style: GoogleFonts.poppins(color: JT.primary, fontWeight: FontWeight.w700),
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
                          child: Text(driver['name']?.toString() ?? 'Driver', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
                        ),
                        if (safetyLabel != null) _safetyBadge(safetyLabel),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${driver['vehicleModel'] ?? ''} · ${driver['vehicleNumber'] ?? ''}',
                      style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _safetyBadge(String label) {
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

  Widget _errorCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFECDD3)),
      ),
      child: Text(_error!, style: GoogleFonts.poppins(color: const Color(0xFFB42318), fontSize: 12)),
    );
  }

  Widget _seatOverviewCard(int seats, double fare) {
    final liveAvailable =
        int.tryParse('${_seatState?['availableSeats'] ?? _booking?['available_seats'] ?? 0}') ?? 0;
    final maxSeats =
        int.tryParse('${_seatState?['maxSeats'] ?? _booking?['max_seats'] ?? seats + liveAvailable}') ??
            (seats + liveAvailable);
    final occupiedSeats = (maxSeats - liveAvailable).clamp(0, maxSeats);

    return _card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: _metric('Booked Seats', '$seats')),
              Expanded(child: _metric('Total Fare', '₹${fare.toStringAsFixed(0)}')),
              Expanded(child: _metric('Live Seats', '$liveAvailable')),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Live Seat View',
            style: GoogleFonts.poppins(
              fontSize: 13,
              color: JT.textPrimary,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: List.generate(maxSeats, (index) {
              final isBooked = index < occupiedSeats;
              return _seatNode(
                label: 'S${index + 1}',
                color: isBooked ? JT.primary : JT.success,
                subtitle: isBooked ? 'Booked' : 'Open',
              );
            }),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _seatLegend('Booked / reserved', JT.primary)),
              const SizedBox(width: 10),
              Expanded(child: _seatLegend('Available now', JT.success)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _metric(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
        const SizedBox(height: 6),
        Text(value, style: GoogleFonts.poppins(fontSize: 18, color: JT.textPrimary, fontWeight: FontWeight.w600)),
      ],
    );
  }

  Widget _seatNode({
    required String label,
    required Color color,
    required String subtitle,
  }) {
    return Container(
      width: 82,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.16)),
      ),
      child: Column(
        children: [
          Icon(Icons.event_seat_rounded, color: color, size: 20),
          const SizedBox(height: 6),
          Text(
            label,
            style: GoogleFonts.poppins(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: JT.textPrimary,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            subtitle,
            style: GoogleFonts.poppins(
              fontSize: 10.5,
              color: JT.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _seatLegend(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: JT.bgSoft,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: GoogleFonts.poppins(
                fontSize: 11,
                color: JT.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _locationRow(IconData icon, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
            color: JT.primary.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(11),
          ),
          child: Icon(icon, color: JT.primary, size: 14),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
              const SizedBox(height: 2),
              Text(value, style: GoogleFonts.poppins(fontSize: 13, color: JT.textPrimary, fontWeight: FontWeight.w500)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4))],
      ),
      child: child,
    );
  }
}
