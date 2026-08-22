import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../core/map_night_style.dart';
import '../../services/error_reporting.dart';
import 'package:flutter/services.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/analytics_service.dart';
import '../../services/socket_service.dart';
import '../../services/alarm_service.dart';
import '../../services/call_service.dart';
import 'package:jago_shared_core/jago_shared_core.dart';
import '../call/call_screen.dart';
import '../profile/support_chat_screen.dart';

import '../main_screen.dart';
import 'trip_completion_screen.dart';

class TrackingScreen extends StatefulWidget {
  final String tripId;
  final bool isParcel;
  final String? bookingType;
  // Fare shown to the customer on the booking/confirm screen before the trip
  // was created — used as a display fallback if the server hasn't returned a
  // usable estimatedFare yet by the time the searching screen first renders.
  final double? initialFareEstimate;
  const TrackingScreen({
    super.key,
    required this.tripId,
    this.isParcel = false,
    this.bookingType,
    this.initialFareEstimate,
  });
  @override
  State<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends State<TrackingScreen>
    with TickerProviderStateMixin, WidgetsBindingObserver {
  final SocketService _socket = SocketService();
  GoogleMapController? _mapController;
  LatLng _center = const LatLng(17.3850, 78.4867);
  LatLng? _driverLatLng;
  double _driverHeading = 0;
  bool _searchCameraCentered = false;
  // Draggable panel height, shared by the searching and cancelled/no-rides
  // screens — both default to 40% of the screen and the user can drag the
  // handle to expand/collapse it (map fills the rest).
  double _draggablePanelHeightFraction = 0.4;
  bool get _isDraggablePanelStatus =>
      _status == 'searching' ||
      _status == 'cancelled' ||
      _status == 'driver_assigned' ||
      _status == 'accepted' ||
      _status == 'arrived' ||
      _status == 'in_progress' ||
      _status == 'on_the_way';
  String _status = 'searching';
  Map<String, dynamic>? _trip;
  double _walletPendingAmount =
      0; // amount customer still owes after wallet deduction
  List<String> _cancelReasons = [];
  late AnimationController _pulseCtrl;
  AnimationController? _driverMoveCtrl;
  LatLng? _animFrom;
  LatLng? _animTo;
  double _animHeadingFrom = 0;
  double _animHeadingTo = 0;
  BitmapDescriptor? _animCachedIcon;
  final Set<Marker> _markers = {};
  final Set<Polyline> _polylines = {};
  // Static pickup→destination route, drawn as a dim background line once the
  // ride starts so the whole planned journey stays visible while _polylines'
  // "remaining route" (driver→destination) is redrawn on top as it moves.
  List<LatLng>? _fullTripRoutePoints;
  final List<StreamSubscription> _subs = [];
  final FlutterTts _tts = FlutterTts();
  StreamSubscription? _incomingCallSub;

  // Booking timeout warning (Feature 1) & Boost Fare (Feature 2)
  Timer? _searchTimeoutTimer;
  Timer? _dispatchRetryTimer;
  Timer? _searchAbortTimer;
  bool _boostLoading = false;
  Timer? _nearbyDriversTimer;
  List<Map<String, dynamic>> _nearbyDrivers = [];

  // Searching-screen UI state (cosmetic only — no backend wiring)
  Timer? _searchStageTimer;
  int _searchStage = 0; // cycles 0..2 to animate "Searching / Verifying / Matching"
  int? _selectedFareAddon;
  static const List<int> _fareAmountPresets = [5, 10, 20];

  StreamSubscription? _connSub;
  Timer? _pollTimer;
  int _statusVersion = 0; // monotonic counter — prevents stale HTTP poll overwriting fresh socket state

  bool _isArriving = false; // "Pilot is about to arrive" flag

  // Custom Top Banner state
  String? _bannerMessage;
  Color _bannerColor = JT.primary;
  Timer? _bannerTimer;
  Timer? _sosTimer;
  bool _sosActive = false;
  DateTime? _lastSocketUpdateAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initTts();
    _pulseCtrl =
        AnimationController(vsync: this, duration: const Duration(seconds: 2))
          ..repeat(reverse: true);
    _connSub = _socket.onConnectionChanged.listen((connected) {
      if (mounted) {
        if (!connected) {
          _showStatusBanner('Waiting for connection...', Colors.orange);
        } else {
          _showStatusBanner('Reconnected!', const Color(0xFF10B981));
          // Re-join tracking room on every reconnect
          if (widget.isParcel) {
            _socket.trackParcel(widget.tripId);
          } else {
            _socket.trackTrip(widget.tripId);
          }
          // Triple poll to reconcile state quickly
          _pollStatus();
          Future.delayed(const Duration(milliseconds: 800), _pollStatus);
          Future.delayed(const Duration(milliseconds: 2500), _pollStatus);
        }
      }
    });
    _connectSocket();
    _pollStatus();
    _loadCancelReasons();
    CallService().init();
    _listenForIncomingCalls();
    // Adaptive HTTP polling: 5s for searching/accepted, 10s for in_progress, stopped for terminal
    _restartPollTimer();
    // Start 90-second timeout warning for searching state
    _startSearchTimeoutTimer();
    _startDispatchRecovery();
    _startNearbyDriversPolling();
    _startSearchStageAnimation();
  }

  // Purely cosmetic loop that cycles the "Searching / Verifying / Matching"
  // step indicator on the searching screen while a pilot is being found.
  void _startSearchStageAnimation() {
    _searchStageTimer?.cancel();
    _searchStage = 0;
    _searchStageTimer =
        Timer.periodic(const Duration(milliseconds: 2200), (timer) {
      if (!mounted || _status != 'searching') {
        timer.cancel();
        return;
      }
      setState(() => _searchStage = (_searchStage + 1) % 3);
    });
  }

  String _eventTripId(Map<String, dynamic> data) {
    final direct = data['tripId'] ??
        data['trip_id'] ??
        data['orderId'] ??
        data['order_id'] ??
        data['id'];
    if (direct != null && direct.toString().isNotEmpty) {
      return direct.toString();
    }
    final trip = data['trip'];
    if (trip is Map) {
      final nested = trip['tripId'] ?? trip['trip_id'] ?? trip['id'];
      if (nested != null && nested.toString().isNotEmpty) {
        return nested.toString();
      }
    }
    return '';
  }

  bool _eventMatchesTrip(Map<String, dynamic> data) {
    final eventTripId = _eventTripId(data);
    return eventTripId.isNotEmpty && eventTripId == widget.tripId;
  }

  bool _isLiveTripStatus(String status) {
    return status == 'in_progress' ||
        status == 'on_the_way' ||
        status == 'in_transit' ||
        status == 'picked_up';
  }

  Map<String, int> _statusRanks() {
    return const {
      'pending': 0,
      'searching': 0,
      'driver_assigned': 1,
      'accepted': 2,
      'picked_up': 3,
      'arrived': 3,
      'in_progress': 4,
      'on_the_way': 4,
      'in_transit': 4,
      'completed': 5,
      'cancelled': 5,
    };
  }

  Map<String, dynamic> _normalizeParcelOrder(Map<String, dynamic> order) {
    final drops = order['drops'] is List
        ? List<Map<String, dynamic>>.from(
            (order['drops'] as List).map((e) => Map<String, dynamic>.from(e as Map)))
        : <Map<String, dynamic>>[];
    final progress = order['progress'] is Map
        ? Map<String, dynamic>.from(order['progress'] as Map)
        : <String, dynamic>{};
    final currentStop = progress['currentStop'] is Map
        ? Map<String, dynamic>.from(progress['currentStop'] as Map)
        : (drops.isNotEmpty ? drops.last : null);
    final dest = currentStop ?? (drops.isNotEmpty ? drops.last : null);

    return {
      'id': order['id'],
      'currentStatus': order['currentStatus'] ?? order['current_status'] ?? _status,
      'driverName': order['driverName'] ?? order['driver_name'],
      'driverPhone': order['driverPhone'] ?? order['driver_phone'],
      'driverLat': order['driverLat'] ?? order['driver_lat'],
      'driverLng': order['driverLng'] ?? order['driver_lng'],
      'pickupLat': order['pickupLat'] ?? order['pickup_lat'],
      'pickupLng': order['pickupLng'] ?? order['pickup_lng'],
      'pickupAddress': order['pickupAddress'] ?? order['pickup_address'],
      'pickupShortName': order['pickupShortName'] ?? order['pickup_short_name'],
      'destinationLat': dest?['lat'] ?? dest?['dropLat'] ?? order['dropLat'] ?? order['drop_lat'],
      'destinationLng': dest?['lng'] ?? dest?['dropLng'] ?? order['dropLng'] ?? order['drop_lng'],
      'destinationAddress':
          dest?['address'] ?? dest?['dropAddress'] ?? order['dropAddress'] ?? order['drop_address'],
      'destinationShortName': dest?['receiverName'] ?? order['receiverName'],
      'estimatedFare': order['totalFare'] ?? order['total_fare'] ?? order['estimatedFare'],
      'vehicleName': order['vehicleCategory'] ?? order['vehicle_category'],
      'type': 'parcel',
      'tripType': 'parcel',
      'parcelDrops': drops,
      'parcelProgress': progress,
    };
  }

  void _onDriverLocationUpdate(Map<String, dynamic> data) {
    if (!mounted) return;
    _lastSocketUpdateAt = DateTime.now();
    final lat = double.tryParse(data['lat']?.toString() ?? '');
    final lng = double.tryParse(data['lng']?.toString() ?? '');
    if (lat != null && lng != null) {
      final nextLatLng = LatLng(lat, lng);
      final heading = _resolveHeading(data, _driverLatLng, nextLatLng);
      if (!widget.isParcel) _checkArrivingStatus(lat, lng);
      final previous = _driverLatLng;
      if (previous == null) {
        // First fix for this trip — nothing to glide from, place it directly.
        setState(() {
          _driverLatLng = nextLatLng;
          _driverHeading = heading;
          _updateMapMarkers();
        });
      } else {
        _animateDriverMarkerTo(previous, nextLatLng, _driverHeading, heading);
      }
      _fetchRouteForStatus();
    }
  }

  // Smoothly glides the driver marker between GPS pings instead of snapping,
  // so vehicle movement reads as continuous rather than jumping every ~5m.
  void _animateDriverMarkerTo(
      LatLng from, LatLng to, double headingFrom, double headingTo) {
    _animFrom = from;
    _animTo = to;
    _animHeadingFrom = headingFrom;
    _animHeadingTo = headingTo;

    var ctrl = _driverMoveCtrl;
    if (ctrl == null) {
      ctrl = AnimationController(
          vsync: this, duration: const Duration(milliseconds: 600));
      _driverMoveCtrl = ctrl;
      final anim = CurvedAnimation(parent: ctrl, curve: Curves.easeInOut);
      anim.addListener(() async {
        if (!mounted || _animFrom == null || _animTo == null) return;
        final t = anim.value;
        final lat = _animFrom!.latitude +
            (_animTo!.latitude - _animFrom!.latitude) * t;
        final lng = _animFrom!.longitude +
            (_animTo!.longitude - _animFrom!.longitude) * t;
        final heading = _lerpHeading(_animHeadingFrom, _animHeadingTo, t);
        _animCachedIcon ??= await _getMarkerIcon(_resolveVehicleLabel());
        if (!mounted) return;
        setState(() {
          _driverLatLng = LatLng(lat, lng);
          _driverHeading = heading;
          _markers.removeWhere((m) => m.markerId == const MarkerId('driver'));
          _markers.add(Marker(
            markerId: const MarkerId('driver'),
            position: _driverLatLng!,
            icon: _animCachedIcon!,
            anchor: const Offset(0.5, 0.5),
            rotation: _driverHeading,
            flat: true,
          ));
        });
        if (ctrl!.status == AnimationStatus.completed) {
          // Full refresh once settled — keeps pickup/destination markers,
          // camera-follow and bounds exactly as before this change.
          _updateMapMarkers();
        }
      });
    }
    ctrl.forward(from: 0);
  }

  double _lerpHeading(double from, double to, double t) {
    double diff = (to - from) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return (from + diff * t + 360) % 360;
  }

  void _applyParcelStatusEvent(Map<String, dynamic> data) {
    if (!_eventMatchesTrip(data)) return;
    final newStatus = data['status']?.toString();
    if (newStatus == null || newStatus.isEmpty) return;

    final statusRank = _statusRanks();
    final incomingRank = statusRank[newStatus] ?? 0;
    final currentRank = statusRank[_status] ?? 0;
    if (incomingRank < currentRank) return;

    if (newStatus != _status) {
      if (newStatus != 'searching') _stopDispatchRecovery();
      _statusVersion++;
      setState(() {
        _status = newStatus;
        final update = <String, dynamic>{};
        if (data['driverName'] != null) update['driverName'] = data['driverName'];
        if (data['driverPhone'] != null) update['driverPhone'] = data['driverPhone'];
        if (data['driverId'] != null) update['driverId'] = data['driverId'];
        _trip = (_trip != null) ? {..._trip!, ...update} : update;
      });
      _handleStatusTransition(newStatus);
      HapticFeedback.lightImpact();
      _pollStatus();
    }

    if (newStatus == 'completed' || newStatus == 'cancelled') {
      _pollTimer?.cancel();
      _pollStatus();
    }
  }

  void _connectSocket() {
    CallService().init();
    if (widget.isParcel) {
      _socket.trackParcel(widget.tripId);
      _subs.add(_socket.onParcelDriverLocation.listen(_onDriverLocationUpdate));
      _subs.add(_socket.onParcelStatus.listen((data) {
        try {
          _applyParcelStatusEvent(Map<String, dynamic>.from(data));
        } catch (e, stack) {
          debugPrint('[SOCKET] Error in onParcelStatus: $e\n$stack');
        }
      }));
      _subs.add(_socket.onParcelCancelled.listen((data) {
        if (!mounted) return;
        if (!_eventMatchesTrip(Map<String, dynamic>.from(data))) return;
        setState(() => _status = 'cancelled');
        _pollTimer?.cancel();
        _showStatusBanner('Parcel delivery was cancelled', Colors.red);
      }));
      _socket.connect(ApiConfig.socketUrl).then((_) {
        _socket.trackParcel(widget.tripId);
        _pollStatus();
      });
      return;
    }

    // Eagerly join the trip room
    _socket.trackTrip(widget.tripId);

    _subs.add(_socket.onDriverLocation.listen(_onDriverLocationUpdate));

    _subs.add(_socket.onTripStatus.listen((data) {
      try {
        _lastSocketUpdateAt = DateTime.now();
        if (!_eventMatchesTrip(data)) return;
        final newStatus = data['status']?.toString();
        if (newStatus == null) return;

        if ((newStatus == 'cancelled' || newStatus == 'searching') &&
            _isLiveTripStatus(_status)) {
          debugPrint(
              '[SOCKET] Ignoring stale $newStatus event after trip start');
          _pollStatus();
          return;
        }

        // Status rank guard: ensure we only move forward in the lifecycle
        const statusRank = {
          'searching': 0,
          'driver_assigned': 1,
          'accepted': 2,
          'arrived': 3,
          'in_progress': 4,
          'on_the_way': 4,
          'completed': 5,
          'cancelled': 5
        };
        final incomingRank = statusRank[newStatus] ?? 0;
        final currentRank = statusRank[_status] ?? 0;

        if (incomingRank < currentRank) {
          debugPrint(
              '[SOCKET] Ignoring stale status update: $newStatus (current: $_status)');
          return;
        }

        if (newStatus != _status) {
          debugPrint('[SOCKET] Trip status transition: $_status -> $newStatus');
          if (newStatus != 'searching') {
            _stopDispatchRecovery();
          }
          _statusVersion++; // socket always wins — bump version so pending HTTP polls are ignored
          setState(() {
            _status = newStatus;

            final Map<String, dynamic> update = {};

            // Merge driver data if present in payload
            if (data['driver'] is Map) {
              final driverMap = Map<String, dynamic>.from(data['driver']);
              update['driverId'] = driverMap['id']?.toString() ??
                  driverMap['userId']?.toString();
              update['driverName'] =
                  driverMap['fullName'] ?? driverMap['full_name'] ?? '';
              update['driverPhone'] = driverMap['phone'] ?? '';
              update['driverRating'] =
                  driverMap['rating'] ?? driverMap['avgRating'];
              update['driverPhoto'] =
                  driverMap['photo'] ?? driverMap['profilePhoto'] ?? '';
              update['driverVehicleNumber'] = driverMap['vehicleNumber'] ??
                  driverMap['vehicle_number'] ??
                  '';
              update['driverVehicleModel'] =
                  driverMap['vehicleModel'] ?? driverMap['vehicle_model'] ?? '';
              update['vehicleName'] = driverMap['vehicleCategory'] ??
                  driverMap['vehicle_category'] ??
                  '';
              update['driverLat'] = driverMap['lat'];
              update['driverLng'] = driverMap['lng'];

              final double? dLat =
                  double.tryParse(update['driverLat']?.toString() ?? '');
              final double? dLng =
                  double.tryParse(update['driverLng']?.toString() ?? '');
              if (dLat != null && dLng != null && dLat != 0) {
                _driverLatLng = LatLng(dLat, dLng);
                _driverHeading = double.tryParse(
                      driverMap['heading']?.toString() ??
                          driverMap['bearing']?.toString() ??
                          '',
                    ) ??
                    _driverHeading;
              }
            }

            // Merge OTP if present (verify-pickup-otp transition)
            final String? incomingOtp =
                data['otp']?.toString() ?? data['pickupOtp']?.toString();
            if (incomingOtp != null && incomingOtp.isNotEmpty) {
              update['pickupOtp'] = incomingOtp;
            }

            if (newStatus == 'completed') {
              _walletPendingAmount = double.tryParse(
                      data['walletPendingAmount']?.toString() ??
                          data['pendingPaymentAmount']?.toString() ??
                          '0') ??
                  _walletPendingAmount;
              AnalyticsService().logRideCompleted(
                rideId: widget.tripId,
                finalFare: double.tryParse(
                        data['finalFare']?.toString() ?? '0') ??
                    0,
              );
            }

            _trip = (_trip != null) ? {..._trip!, ...update} : update;
          });

          // UI transitions & feedback
          _handleStatusTransition(newStatus);
          HapticFeedback.lightImpact();
          // Immediately reconcile — don't wait for next poll tick.
          _pollStatus();
          Future.delayed(const Duration(milliseconds: 1500), _pollStatus);
          Future.delayed(const Duration(milliseconds: 3000), _pollStatus);
        }

        if (newStatus == 'completed' || newStatus == 'cancelled') {
          _pollTimer?.cancel();
          _pollStatus();
        }
      } catch (e, stack) {
        debugPrint('[SOCKET] Error in onTripStatus: $e\n$stack');
      }
    }));

    // Detailed driver assignment info
    _subs.add(_socket.onDriverAssigned.listen((data) {
      if (!mounted) return;
      _searchTimeoutTimer?.cancel();
      _stopDispatchRecovery();
      final driverData = data['driver'];
      final driverId = data['driverId']?.toString();
      final driverMap =
          driverData is Map ? Map<String, dynamic>.from(driverData) : null;
      final pickupOtp =
          data['pickupOtp']?.toString() ?? data['otp']?.toString();

      setState(() {
        _status = data['status'] ?? data['currentStatus'] ?? 'accepted';
        final Map<String, dynamic> update = {};
        if (pickupOtp != null && pickupOtp.isNotEmpty)
          update['pickupOtp'] = pickupOtp;
        if (driverId != null) update['driverId'] = driverId;

        if (driverMap != null) {
          update['driverName'] = driverMap['fullName'] ??
              driverMap['full_name'] ??
              driverMap['name'] ??
              'Jago Pilot';
          update['driverPhone'] =
              driverMap['phone'] ?? driverMap['mobile'] ?? '';
          update['driverRating'] =
              driverMap['rating'] ?? driverMap['avgRating'] ?? 5.0;
          update['driverPhoto'] =
              driverMap['photo'] ?? driverMap['profilePhoto'] ?? '';
          update['driverVehicleNumber'] = driverMap['vehicleNumber'] ??
              driverMap['vehicle_number'] ??
              driverMap['vehicle_no'] ??
              '';
          update['driverVehicleModel'] = driverMap['vehicleModel'] ??
              driverMap['vehicle_model'] ??
              driverMap['model'] ??
              '';
          update['vehicleName'] = driverMap['vehicleCategory'] ??
              driverMap['vehicle_category'] ??
              driverMap['vehicle_name'] ??
              'Pilot';
          update['driverLat'] = driverMap['lat'];
          update['driverLng'] = driverMap['lng'];
        } else {
          update['driverName'] =
              data['driverName'] ?? data['driver_name'] ?? 'Jago Pilot';
          update['driverPhone'] = data['driverPhone'] ?? data['driver_phone'];
          update['driverRating'] = data['driverRating'] ?? data['driver_rating'];
          update['driverPhoto'] = data['driverPhoto'] ?? data['driver_photo'];
          update['driverVehicleNumber'] =
              data['driverVehicleNumber'] ?? data['driver_vehicle_number'];
          update['driverVehicleModel'] =
              data['driverVehicleModel'] ?? data['driver_vehicle_model'];
          update['vehicleName'] =
              data['vehicleName'] ??
              data['vehicle_name'] ??
              data['vehicleCategory'] ??
              data['vehicle_category'] ??
              _trip?['vehicleCategory'] ??
              _trip?['vehicleCategoryName'] ??
              'cab';
        }

        if (_trip != null) {
          _trip = {..._trip!, ...update};
        } else {
          _trip = update;
        }
      });

      final dLat = double.tryParse(_trip?['driverLat']?.toString() ?? '');
      final dLng = double.tryParse(_trip?['driverLng']?.toString() ?? '');
      if (dLat != null && dLng != null && dLat != 0) {
        _driverLatLng = LatLng(dLat, dLng);
        _updateMapMarkers();
      }

      _showStatusBanner('Pilot accepted your ride', JT.primary);
      AlarmService().playChime();
      HapticFeedback.heavyImpact();
      _announceStatus('accepted');
      // Immediate reconciliation poll to load driver details + route data
      _pollStatus();
      // Also fetch route using the driver's current location if available
      if (_driverLatLng != null) _fetchRouteForStatus();
    }));

    _subs.add(_socket.onTripCancelled.listen((data) {
      if (!mounted) return;
      if (!_eventMatchesTrip(data)) return;
      if (_isLiveTripStatus(_status)) {
        debugPrint('[SOCKET] Verifying late cancel event after trip start');
        _pollStatus();
        return;
      }
      setState(() => _status = 'cancelled');
      _pollTimer?.cancel();
      _showStatusBanner('Trip was cancelled', Colors.red);
      _announceStatus('cancelled');
    }));

    _socket.connect(ApiConfig.socketUrl).then((_) {
      // Refresh state after connection establishes
      _socket.trackTrip(widget.tripId);
      _pollStatus();
    });

    // Re-searching for driver (after rejection)
    _subs.add(_socket.onTripSearching.listen((data) {
      if (!mounted) return;
      if (!_eventMatchesTrip(data)) return;
      if (_isLiveTripStatus(_status) ||
          _status == 'completed' ||
          _status == 'cancelled') {
        _pollStatus();
        return;
      }
      setState(() => _status = 'searching');
      _searchCameraCentered = false;
      _draggablePanelHeightFraction = 0.4;
      // Restart the 90s timeout warning since we're back to searching
      _startSearchTimeoutTimer();
      _startDispatchRecovery();
      _startSearchStageAnimation();
    }));

    // No drivers available — trip auto-cancelled
    _subs.add(_socket.onNoDrivers.listen((data) {
      if (!mounted) return;
      if (!_eventMatchesTrip(data)) return;
      if (_status != 'searching') {
        debugPrint('[SOCKET] Ignoring stale no-drivers event in $_status');
        _pollStatus();
        return;
      }
      _pollTimer?.cancel();
      _showNoDriversDialog();
    }));
  }

  // No drivers available → set cancelled state (UI handled by _buildCancelledCard)
  void _showNoDriversDialog() {
    if (!mounted) return;
    if (_status != 'searching') return;
    setState(() => _status = 'cancelled');
    _showStatusBanner('No pilots nearby. Try again!', const Color(0xFFDC2626));
  }


  Future<void> _startNearbyDriversPolling() async {
    _nearbyDriversTimer?.cancel();
    if (!mounted || _status != 'searching') return;
    _fetchNearbyDrivers();
    _nearbyDriversTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (_status == 'searching') {
        _fetchNearbyDrivers();
      } else {
        _nearbyDriversTimer?.cancel();
      }
    });
  }

  Future<void> _fetchNearbyDrivers() async {
    if (!mounted || _status != 'searching') return;
    try {
      final pLat = double.tryParse(_trip?['pickupLat']?.toString() ?? '');
      final pLng = double.tryParse(_trip?['pickupLng']?.toString() ?? '');
      if (pLat == null || pLng == null) return;

      final headers = await AuthService.getHeaders();
      final uri = Uri.parse(ApiConfig.nearbyDrivers).replace(queryParameters: {
        'lat': pLat.toString(),
        'lng': pLng.toString(),
        'radius': '3',
      });
      final r = await http
          .get(uri, headers: headers)
          .timeout(const Duration(seconds: 5));
      if (!mounted || r.statusCode != 200) return;

      final data = jsonDecode(r.body) as Map<String, dynamic>;
      final drivers =
          (data['drivers'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ??
              [];
      setState(() => _nearbyDrivers = drivers);
      _updateMapMarkers();
    } catch (_) {}
  }

  String _resolveVehicleLabel() {
    final booked = (_trip?['vehicleCategory'] ??
            _trip?['vehicleCategoryName'] ??
            _trip?['vehicleType'] ??
            _trip?['vehicle_type'] ??
            '')
        .toString();
    final assigned = (_trip?['vehicleName'] ?? _trip?['vehicle_name'] ?? '').toString();
    if (assigned.isNotEmpty && assigned.toLowerCase() != 'pilot') return assigned;
    if (booked.isNotEmpty) return booked;
    return 'cab';
  }

  // Photo-based markers (bike/auto/mini_car/sedan/premium/bike_parcel) are
  // resolved centrally by JagoMapMarkers.vehicle — see
  // shared_core/src/widgets/jago_map_markers.dart — with automatic fallback
  // to the existing hand-drawn icon for any other/unrecognized type.
  Future<BitmapDescriptor> _getMarkerIcon(String type,
      {bool isSearching = false}) async {
    return JagoMapMarkers.vehicle(type, searching: isSearching);
  }


  Future<BitmapDescriptor> _destinationMarkerIcon() =>
      JagoMapMarkers.destination();

  void _handleStatusTransition(String newStatus) {
    _restartPollTimer();
    if (newStatus == 'accepted' || newStatus == 'driver_assigned') {
      _showStatusBanner('Pilot accepted your ride', JT.primary);
      _announceStatus('accepted');
      _updateMapMarkers();
    } else if (newStatus == 'arrived') {
      _showStatusBanner('Your pilot has arrived', const Color(0xFF10B981));
      _announceStatus('arrived');
      _updateMapMarkers();
    } else if (newStatus == 'in_progress' || newStatus == 'on_the_way') {
      _animateToDestination();
      _showStatusBanner('Ride started • Have a safe journey!', JT.primary);
      _fetchRouteForStatus();
      _fetchFullTripRoute();
      _updateMapMarkers();
      // Ride-started card starts small so the map gets most of the screen —
      // still draggable up via _isDraggablePanelStatus.
      _draggablePanelHeightFraction = 0.2;
    } else if (newStatus == 'completed') {
      _showStatusBanner('Trip Completed • Thank you!', const Color(0xFF10B981));
      setState(() {
        _polylines.clear();
        _fullTripRoutePoints = null;
      });
      _updateMapMarkers();
      
      // Navigate to premium completion screen
      Future.delayed(const Duration(milliseconds: 800), () {
        if (mounted) {
          Navigator.pushReplacement(
            context,
            MaterialPageRoute(
              builder: (_) => TripCompletionScreen(
                trip: _trip ?? {'id': widget.tripId},
                walletPendingAmount: _walletPendingAmount,
              ),
            ),
          );
        }
      });
    } else if (newStatus == 'cancelled') {
      _showStatusBanner('Trip Cancelled', const Color(0xFFDC2626));
      setState(() {
        _polylines.clear();
        _fullTripRoutePoints = null;
      });
    }
  }

  // ── Polyline & Routing ────────────────────────────────────────────────────

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

  Future<void> _fetchRouteForStatus() async {
    if (_driverLatLng == null || _trip == null) return;

    // Status rank: search=0, assigned/accepted=1/2, arrived=3, on_the_way=4
    final isGoingToPickup = _status == 'accepted' ||
        _status == 'driver_assigned' ||
        _status == 'arrived';
    final isGoingToDrop = _status == 'in_progress' || _status == 'on_the_way';

    if (!isGoingToPickup && !isGoingToDrop) {
      if (_polylines.isNotEmpty) setState(() => _polylines.clear());
      return;
    }

    double destLat, destLng;
    if (isGoingToPickup) {
      destLat = double.tryParse(_trip?['pickupLat']?.toString() ?? '') ?? 0.0;
      destLng = double.tryParse(_trip?['pickupLng']?.toString() ?? '') ?? 0.0;
    } else {
      destLat =
          double.tryParse(_trip?['destinationLat']?.toString() ?? '') ?? 0.0;
      destLng =
          double.tryParse(_trip?['destinationLng']?.toString() ?? '') ?? 0.0;
    }

    if (destLat == 0 || destLng == 0) return;

    // Fetch route from driver to target
    await _fetchRoute(
        _driverLatLng!.latitude, _driverLatLng!.longitude, destLat, destLng);
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
        if (overviewPolyline != null && mounted) {
          final pts = _decodePolyline(overviewPolyline);
          setState(() {
            _polylines.clear();
            _polylines.add(Polyline(
              polylineId: const PolylineId('route'),
              points: pts,
              color: JT.primary,
              width: 5,
              jointType: JointType.round,
              startCap: Cap.roundCap,
              endCap: Cap.roundCap,
            ));
          });

          // Fit markers and route in view if significant movement occurred
          _fitMarkersToScreen();
        }
      }
    } catch (e, st) {
      reportSilentFailure('TrackingScreen._fetchRoute', e, st);
    }
  }

  Future<void> _fetchFullTripRoute() async {
    final pLat = double.tryParse(_trip?['pickupLat']?.toString() ?? '');
    final pLng = double.tryParse(_trip?['pickupLng']?.toString() ?? '');
    final dLat = double.tryParse(_trip?['destinationLat']?.toString() ?? '');
    final dLng = double.tryParse(_trip?['destinationLng']?.toString() ?? '');
    if (pLat == null || pLng == null || dLat == null || dLng == null || dLat == 0) {
      return;
    }
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .post(
            Uri.parse(ApiConfig.routeMultiWaypoint),
            headers: {...headers, 'Content-Type': 'application/json'},
            body: jsonEncode({
              'origin': {'lat': pLat, 'lng': pLng},
              'destination': {'lat': dLat, 'lng': dLng},
              'waypoints': [],
              'optimize': false,
            }),
          )
          .timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final overviewPolyline = data['overviewPolyline']?.toString();
        if (overviewPolyline != null && mounted) {
          setState(
              () => _fullTripRoutePoints = _decodePolyline(overviewPolyline));
        }
      }
    } catch (e, st) {
      reportSilentFailure('TrackingScreen._fetchFullTripRoute', e, st);
    }
  }

  void _fitMarkersToScreen() {
    if (_mapController == null || _driverLatLng == null) return;

    final pLat = double.tryParse(_trip?['pickupLat']?.toString() ?? '') ?? 0.0;
    final pLng = double.tryParse(_trip?['pickupLng']?.toString() ?? '') ?? 0.0;
    final dLat =
        double.tryParse(_trip?['destinationLat']?.toString() ?? '') ?? 0.0;
    final dLng =
        double.tryParse(_trip?['destinationLng']?.toString() ?? '') ?? 0.0;

    double targetLat =
        (_status == 'in_progress' || _status == 'on_the_way') ? dLat : pLat;
    double targetLng =
        (_status == 'in_progress' || _status == 'on_the_way') ? dLng : pLng;

    if (targetLat == 0) return;

    final bounds = LatLngBounds(
      southwest: LatLng(
        math.min(_driverLatLng!.latitude, targetLat),
        math.min(_driverLatLng!.longitude, targetLng),
      ),
      northeast: LatLng(
        math.max(_driverLatLng!.latitude, targetLat),
        math.max(_driverLatLng!.longitude, targetLng),
      ),
    );
    _mapController?.animateCamera(CameraUpdate.newLatLngBounds(bounds, 120));
  }

  void _updateMapMarkers() async {
    final Set<Marker> newMarkers = {};

    // 1. Pickup Location Marker (Search center) — shown as the booked vehicle
    // type (e.g. bike) with the searching pulse ring, not a generic magnifier,
    // so it reads as "this is what you're waiting for" rather than a search icon.
    final pLat = double.tryParse(_trip?['pickupLat']?.toString() ?? '');
    final pLng = double.tryParse(_trip?['pickupLng']?.toString() ?? '');
    if (pLat != null && pLng != null) {
      newMarkers.add(Marker(
        markerId: const MarkerId('pickup'),
        position: LatLng(pLat, pLng),
        icon: await _getMarkerIcon(_resolveVehicleLabel(), isSearching: true),
        anchor: const Offset(0.5, 0.5),
      ));
      _center = LatLng(pLat, pLng);
      // The GoogleMap widget's initialCameraPosition only applies once, at
      // creation — updating _center afterward doesn't move an already-live
      // map. Previously nothing ever animated the camera here during
      // 'searching' (no driver yet), so the map stayed on its hardcoded
      // default position instead of the customer's actual pickup point.
      // Center once per search so a manual pan/zoom by the user isn't
      // fought on every 5s marker refresh.
      if (_status == 'searching' &&
          _mapController != null &&
          !_searchCameraCentered) {
        _searchCameraCentered = true;
        _mapController!
            .animateCamera(CameraUpdate.newLatLngZoom(LatLng(pLat, pLng), 16));
      }
    }

    // 2. Assigned Driver Marker
    if (_driverLatLng != null &&
        _status != 'searching' &&
        _status != 'cancelled') {
      final vName = _resolveVehicleLabel();
      newMarkers.add(Marker(
        markerId: const MarkerId('driver'),
        position: _driverLatLng!,
        icon: await _getMarkerIcon(vName),
        anchor: const Offset(0.5, 0.5),
        rotation: _driverHeading,
        flat: true,
      ));
      if (_status != 'completed') {
        _mapController
            ?.animateCamera(CameraUpdate.newLatLngZoom(_driverLatLng!, 16));
      }
    }

    // 3. Destination Marker (visible during and after trip)
    final dLat = double.tryParse(_trip?['destinationLat']?.toString() ??
        _trip?['destination_lat']?.toString() ??
        '');
    final dLng = double.tryParse(_trip?['destinationLng']?.toString() ??
        _trip?['destination_lng']?.toString() ??
        '');
    if (dLat != null &&
        dLng != null &&
        dLat != 0 &&
        (_status == 'in_progress' ||
            _status == 'on_the_way' ||
            _status == 'completed')) {
      newMarkers.add(Marker(
        markerId: const MarkerId('destination'),
        position: LatLng(dLat, dLng),
        icon: await _destinationMarkerIcon(),
        anchor: const Offset(0.5, 0.9),
      ));

      if (_driverLatLng != null && _mapController != null) {
        final bounds = LatLngBounds(
          southwest: LatLng(
            _driverLatLng!.latitude < dLat ? _driverLatLng!.latitude : dLat,
            _driverLatLng!.longitude < dLng ? _driverLatLng!.longitude : dLng,
          ),
          northeast: LatLng(
            _driverLatLng!.latitude > dLat ? _driverLatLng!.latitude : dLat,
            _driverLatLng!.longitude > dLng ? _driverLatLng!.longitude : dLng,
          ),
        );
        _mapController
            ?.animateCamera(CameraUpdate.newLatLngBounds(bounds, 100));
      }
    }

    // 3. Nearby Pilots (visible only during searching)
    if (_status == 'searching') {
      for (final d in _nearbyDrivers) {
        final dLat = double.tryParse(d['lat']?.toString() ?? '');
        final dLng = double.tryParse(d['lng']?.toString() ?? '');
        if (dLat == null || dLng == null) continue;
        final id = d['id']?.toString() ?? '';
        final vName =
            (d['vehicleCategoryName'] ?? d['vehicleName'] ?? 'bike').toString();
        newMarkers.add(Marker(
          markerId: MarkerId('nearby_$id'),
          position: LatLng(dLat, dLng),
          icon: await _getMarkerIcon(vName, isSearching: true),
          anchor: const Offset(0.5, 0.5),
          rotation: double.tryParse(d['heading']?.toString() ?? '0') ?? 0,
          flat: true,
        ));
      }
    }

    if (mounted) {
      setState(() {
        _markers.clear();
        _markers.addAll(newMarkers);
      });
    }
  }

  void _checkArrivingStatus(double dLat, double dLng) {
    if (_status != 'accepted' &&
        _status != 'driver_assigned' &&
        _status != 'arrived') return;

    final pLat = double.tryParse(_trip?['pickupLat']?.toString() ?? '');
    final pLng = double.tryParse(_trip?['pickupLng']?.toString() ?? '');
    if (pLat == null || pLng == null) return;

    final double dist =
        _calculateDistance(dLat, dLng, pLat, pLng); // result in km

    // If within 500 meters and not already marked as arriving
    if (dist < 0.5 && !_isArriving && _status != 'arrived') {
      setState(() => _isArriving = true);
      // _announceStatus('arriving');
      HapticFeedback.mediumImpact();
    } else if (dist >= 0.5 && _isArriving) {
      setState(() => _isArriving = false);
    }
  }

  double _calculateDistance(
      double lat1, double lon1, double lat2, double lon2) {
    const double p = 0.017453292519943295;
    final double a = 0.5 -
        math.cos((lat2 - lat1) * p) / 2 +
        math.cos(lat1 * p) *
            math.cos(lat2 * p) *
            (1 - math.cos((lon2 - lon1) * p)) /
            2;
    return 12742 * math.asin(math.sqrt(a));
  }

  double _resolveHeading(
    Map<String, dynamic> data,
    LatLng? previous,
    LatLng next,
  ) {
    final incoming = double.tryParse(
      data['heading']?.toString() ?? data['bearing']?.toString() ?? '',
    );
    if (incoming != null && incoming.isFinite && incoming != 0) {
      return incoming;
    }
    if (previous == null) return _driverHeading;
    return _bearingBetween(previous, next);
  }

  double _bearingBetween(LatLng from, LatLng to) {
    final fromLat = from.latitude * math.pi / 180;
    final fromLng = from.longitude * math.pi / 180;
    final toLat = to.latitude * math.pi / 180;
    final toLng = to.longitude * math.pi / 180;
    final deltaLng = toLng - fromLng;
    final y = math.sin(deltaLng) * math.cos(toLat);
    final x = math.cos(fromLat) * math.sin(toLat) -
        math.sin(fromLat) * math.cos(toLat) * math.cos(deltaLng);
    final bearing = math.atan2(y, x) * 180 / math.pi;
    return (bearing + 360) % 360;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final s in _subs) s.cancel();
    _connSub?.cancel();
    _incomingCallSub?.cancel();
    _pollTimer?.cancel();
    _searchTimeoutTimer?.cancel();
    _nearbyDriversTimer?.cancel();
    _searchStageTimer?.cancel();
    _bannerTimer?.cancel();
    _sosTimer?.cancel();
    _stopDispatchRecovery();
    _pulseCtrl.dispose();
    _driverMoveCtrl?.dispose();
    _tts.stop();
    _mapController?.dispose();
    // Leave the trip socket room — shared singleton stays connected for other trips
    _socket.stopTrackingTrip(widget.tripId);
    if (widget.isParcel) _socket.stopTrackingParcel(widget.tripId);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      if (!_socket.isConnected) {
        _socket.connect(ApiConfig.socketUrl);
      }
      if (widget.isParcel) {
        _socket.trackParcel(widget.tripId);
      } else {
        _socket.trackTrip(widget.tripId);
      }
      _pollStatus();
    }
  }

  void _listenForIncomingCalls() {
    _incomingCallSub = _socket.onCallIncoming.listen((data) {
      if (!mounted) return;
      final callerName = data['callerName']?.toString() ?? 'Driver';
      final callerId = data['callerId']?.toString() ?? '';
      final tripId = data['tripId']?.toString() ?? widget.tripId;
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

  Future<void> _initTts() async {
    try {
      await _tts.setLanguage('en-IN');
      await _tts.setSpeechRate(0.44);
      await _tts.setPitch(1.0);
      await _tts.setVolume(1.0);
    } catch (_) {}
  }

  Future<void> _announceStatus(String status) async {
    /* 
    // Temporarily disabled to troubleshoot "Lost connection" crash on Android
    if (status == _lastAnnouncedStatus) return;
    _lastAnnouncedStatus = status;
    String? message;
    switch (status) {
      case 'driver_assigned':
      case 'accepted':
        message = 'Pilot accepted your ride and is on the way.';
        break;
      case 'arriving':
        message = 'Your pilot is about to arrive at your location.';
        break;
      case 'arrived':
        message = 'Your pilot is arrived at the pickup location.';
        break;
      case 'in_progress':
      case 'on_the_way':
        message = 'Your ride is started. Have a safe journey.';
        break;
      case 'completed':
        message = 'Your ride is ended. Thank you for choosing Jago.';
        break;
      case 'cancelled':
        message = 'Trip has been cancelled.';
        break;
    }
    if (message == null) return;
    try {
      await _tts.stop();
      await _tts.speak(message);
    } catch (_) {}
    */
  }

  // ── Feature 1: Booking Timeout Warning ────────────────────────────────────
  void _startSearchTimeoutTimer() {
    _searchTimeoutTimer?.cancel();
    _searchTimeoutTimer = Timer(const Duration(seconds: 90), () {
      if (!mounted || _status != 'searching') return;
      _showBookingTimeoutWarning();
    });
  }

  void _startDispatchRecovery() {
    _dispatchRetryTimer?.cancel();
    _searchAbortTimer?.cancel();
    debugPrint('[DISPATCH] Searching for pilot tripId=${widget.tripId}');
    int _retryCount = 0;
    _dispatchRetryTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!mounted || _status != 'searching') return;
      _retryCount++;
      // Exponential back-off: after 4 retries (60s), poll less frequently.
      // Multiplier: 1,1,1,1,2,2,4,4,8… capped at every 60s tick (4 ticks = 60s gap).
      final gap = math.min(math.pow(2, math.max(0, _retryCount - 4)).toInt(), 4);
      if (_retryCount > 4 && _retryCount % gap != 0) return;
      debugPrint(
          '[DISPATCH] Search retry #$_retryCount: rejoining room and reconciling tripId=${widget.tripId}');
      if (widget.isParcel) {
        _socket.trackParcel(widget.tripId);
      } else {
        _socket.trackTrip(widget.tripId);
      }
      _pollStatus();
    });
    _searchAbortTimer = Timer(const Duration(minutes: 5), () {
      if (!mounted || _status != 'searching') return;
      debugPrint(
          '[DISPATCH] Search timeout: cancelling tripId=${widget.tripId}');
      _showStatusBanner(
          widget.isParcel
              ? 'No delivery partner accepted. Please try again.'
              : 'No pilots accepted the ride. Please try again.',
          Colors.red);
      _cancelTrip(widget.isParcel
          ? 'No delivery partner accepted within 5 minutes'
          : 'No pilot accepted within 5 minutes');
    });
  }

  void _stopDispatchRecovery() {
    _dispatchRetryTimer?.cancel();
    _dispatchRetryTimer = null;
    _searchAbortTimer?.cancel();
    _searchAbortTimer = null;
  }

  void _showBookingTimeoutWarning() {
    if (!mounted) return;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        backgroundColor: Colors.white,
        title: Row(children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: const Color(0xFFF59E0B).withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.timer_outlined,
                color: Color(0xFFF59E0B), size: 22),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text('Search is taking long',
                style: GoogleFonts.poppins(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: JT.textPrimary)),
          ),
        ]),
        content: Text(
          'We haven\'t found a pilot yet. You can boost your fare to attract more drivers, or cancel the trip.',
          style: GoogleFonts.poppins(
              fontSize: 13, color: const Color(0xFF6B7280), height: 1.5),
        ),
        actionsPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        actionsAlignment: MainAxisAlignment.spaceBetween,
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _showCancelDialog();
            },
            child: Text('Cancel Trip',
                style: GoogleFonts.poppins(
                    color: const Color(0xFFDC2626),
                    fontWeight: FontWeight.w400,
                    fontSize: 13)),
          ),
          ElevatedButton.icon(
            onPressed: () {
              Navigator.pop(ctx);
              _showBoostFareSheet();
            },
            icon: const Icon(Icons.bolt_rounded, size: 16),
            label: Text('Boost Fare',
                style: GoogleFonts.poppins(
                    fontWeight: FontWeight.w500, fontSize: 13)),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2F7BFF),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            ),
          ),
        ],
      ),
    );
  }

  // ── Feature 2: Boost Fare ──────────────────────────────────────────────────
  Future<void> _boostFare(int amount) async {
    if (_boostLoading) return;
    setState(() => _boostLoading = true);
    try {
      final headers = await AuthService.getHeaders();
      final tripId = _trip?['id']?.toString() ?? widget.tripId;
      final res = await http.post(
        Uri.parse(ApiConfig.boostFare(tripId)),
        headers: headers,
        body: jsonEncode({'boostAmount': amount}),
      ).timeout(const Duration(seconds: 10));
      if (!mounted) return;
      if (res.statusCode == 200) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Row(children: [
            const Icon(Icons.bolt_rounded, color: Colors.white, size: 16),
            const SizedBox(width: 8),
            Text('Fare boosted by ₹$amount! Searching for pilots...',
                style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontWeight: FontWeight.w400,
                    fontSize: 13)),
          ]),
          backgroundColor: const Color(0xFF2F7BFF),
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          duration: const Duration(seconds: 4),
        ));
        // Restart the 90s timer after boost
        _startSearchTimeoutTimer();
      } else {
        final err = jsonDecode(res.body);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              err['message']?.toString() ?? 'Boost failed. Try again.',
              style: GoogleFonts.poppins(color: Colors.white, fontSize: 13)),
          backgroundColor: const Color(0xFFDC2626),
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text('Network error. Try again.',
              style: GoogleFonts.poppins(color: Colors.white, fontSize: 13)),
          backgroundColor: const Color(0xFFDC2626),
          behavior: SnackBarBehavior.floating,
          margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ));
      }
    }
    if (mounted) setState(() => _boostLoading = false);
  }

  void _showBoostFareSheet() {
    if (!mounted) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (_) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          boxShadow: [
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.15), blurRadius: 30)
          ],
        ),
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 44,
            height: 4,
            decoration: BoxDecoration(
                color: const Color(0xFFE5E7EB),
                borderRadius: BorderRadius.circular(2)),
          ),
          const SizedBox(height: 20),
          Row(children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: const Color(0xFF2F7BFF).withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.bolt_rounded,
                  color: Color(0xFF2F7BFF), size: 24),
            ),
            const SizedBox(width: 14),
            Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                  Text('Boost Your Fare',
                      style: GoogleFonts.poppins(
                          fontSize: 17,
                          fontWeight: FontWeight.w500,
                          color: JT.textPrimary)),
                  Text('Add extra to attract more pilots',
                      style: GoogleFonts.poppins(
                          fontSize: 12, color: const Color(0xFF6B7280))),
                ])),
          ]),
          const SizedBox(height: 22),
          Row(children: [
            _buildBoostOption(10),
            const SizedBox(width: 10),
            _buildBoostOption(20),
            const SizedBox(width: 10),
            _buildBoostOption(50),
          ]),
          const SizedBox(height: 10),
          Text('Boost amount will be added to the trip fare',
              style: GoogleFonts.poppins(
                  color: const Color(0xFF9CA3AF), fontSize: 11),
              textAlign: TextAlign.center),
        ]),
      ),
    );
  }

  Widget _buildBoostOption(int amount) {
    return Expanded(
      child: GestureDetector(
        onTap: _boostLoading
            ? null
            : () {
                Navigator.pop(context);
                _boostFare(amount);
              },
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 18),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [const Color(0xFF2F7BFF), const Color(0xFF1A5FCC)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(16),
            boxShadow: [
              BoxShadow(
                  color: const Color(0xFF2F7BFF).withValues(alpha: 0.3),
                  blurRadius: 12,
                  offset: const Offset(0, 4))
            ],
          ),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.bolt_rounded, color: Colors.white, size: 20),
            const SizedBox(height: 4),
            Text('₹$amount',
                style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w500)),
            Text('Boost',
                style:
                    GoogleFonts.poppins(color: Colors.white70, fontSize: 10)),
          ]),
        ),
      ),
    );
  }

  Future<void> _loadCancelReasons() async {
    try {
      final res = await http.get(Uri.parse(ApiConfig.configs)).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final reasons = (data['cancellationReasons'] as List<dynamic>? ?? [])
            .where((r) =>
                r['userType'] == 'customer' || r['user_type'] == 'customer')
            .map((r) => r['reason']?.toString() ?? '')
            .where((r) => r.isNotEmpty)
            .toList();
        if (mounted) setState(() => _cancelReasons = reasons);
      }
    } catch (_) {}
  }

  void _restartPollTimer() {
    _pollTimer?.cancel();
    if (_status == 'completed' || _status == 'cancelled') return;
    final interval = _status == 'in_progress' ||
            _status == 'on_the_way' ||
            _status == 'in_transit'
        ? const Duration(seconds: 10)
        : const Duration(seconds: 5);
    _pollTimer = Timer.periodic(interval, (_) => _pollStatus());
  }

  Future<void> _pollStatus() async {
    if (!mounted) return;
    // HTTP polling exists purely as a fallback for when the socket goes
    // silent - skip this tick if the socket is connected and has pushed a
    // fresh update more recently than this poll interval, so a healthy
    // socket connection doesn't also drive a redundant parallel HTTP call
    // every 5-10s for the entire trip.
    final lastSocketUpdate = _lastSocketUpdateAt;
    if (_socket.isConnected &&
        lastSocketUpdate != null &&
        DateTime.now().difference(lastSocketUpdate) < const Duration(seconds: 8)) {
      return;
    }
    final versionAtStart = _statusVersion; // capture before any await
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .get(
            Uri.parse(widget.isParcel
                ? ApiConfig.parcelTrack(widget.tripId)
                : '${ApiConfig.trackTrip}/${widget.tripId}'),
            headers: headers,
          )
          .timeout(const Duration(seconds: 10));

      if (!mounted) return;
      if (_statusVersion != versionAtStart) return; // socket already updated — discard stale poll

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final Map<String, dynamic>? tripRaw = widget.isParcel
            ? _normalizeParcelOrder(
                Map<String, dynamic>.from(data['order'] as Map? ?? {}))
            : (data['trip'] is Map
                ? Map<String, dynamic>.from(data['trip'] as Map)
                : null);
        if (tripRaw != null && tripRaw.isNotEmpty) {
          final trip = tripRaw;
          final rawStatus = trip['currentStatus']?.toString() ?? _status;
          final resolvedStatus =
              rawStatus == 'payment_pending' ? 'completed' : rawStatus;

          final statusRank = _statusRanks();

          final currentRank = statusRank[_status] ?? 0;
          final incomingRank = statusRank[resolvedStatus] ?? 0;

          if ((resolvedStatus == 'cancelled' || resolvedStatus == 'searching') &&
              _isLiveTripStatus(_status)) {
            debugPrint(
                '[POLL] Ignoring stale $resolvedStatus while trip is $_status');
            return;
          }

          if (incomingRank >= currentRank) {
            setState(() {
              // Preserve existing critical data if missing in poll
              if (_trip != null) {
                final List<String> criticalKeys = [
                  'driverName',
                  'driverPhone',
                  'driverRating',
                  'driverPhoto',
                  'driverVehicleNumber',
                  'driverVehicleModel',
                  'vehicleName',
                  'driverLat',
                  'driverLng',
                  'pickupOtp',
                  'destinationAddress',
                  'pickupAddress',
                  'pickupShortName',
                  'destinationShortName',
                  'actualFare',
                  'estimatedFare',
                  'estimatedDistance',
                  'type',
                  'tripType',
                ];
                for (var key in criticalKeys) {
                  if ((trip[key] == null || trip[key].toString().isEmpty) &&
                      (_trip![key] != null &&
                          _trip![key].toString().isNotEmpty)) {
                    trip[key] = _trip![key];
                  }
                }
              }

              final bool statusChanged = _status != resolvedStatus;
              _trip = trip;
              _status = resolvedStatus;

              if (resolvedStatus == 'completed') {
                _walletPendingAmount = double.tryParse(
                      trip['walletPendingAmount']?.toString() ??
                          trip['pendingPaymentAmount']?.toString() ??
                          '0',
                    ) ??
                    _walletPendingAmount;
              }

              if (statusChanged) {
                if (resolvedStatus != 'searching') {
                  _stopDispatchRecovery();
                }
                _handleStatusTransition(resolvedStatus);
              }
            });
          }

          final dLat = double.tryParse(trip['driverLat']?.toString() ?? '');
          final dLng = double.tryParse(trip['driverLng']?.toString() ?? '');
          if (dLat != null && dLng != null && dLat != 0) {
            _driverLatLng = LatLng(dLat, dLng);
            _updateMapMarkers();
          }

          if (_status == 'completed' || _status == 'cancelled') {
            _pollTimer?.cancel();
          }
        }
      } else if (res.statusCode == 401) {
        debugPrint('[POLL] Session expired (401) during trip tracking');
        // We DON'T redirect to login here to avoid kicking out a tracking user.
        // The socket will likely still keep them updated.
      }
    } catch (e) {
      debugPrint('[POLL] Network error in status sync: $e');
    }
  }

  Future<void> _cancelTrip(String reason) async {
    if (widget.isParcel) {
      _socket.cancelParcel(widget.tripId, reason: reason);
      bool httpCancelOk = false;
      try {
        final headers = await AuthService.getHeaders();
        final res = await http
            .post(
              Uri.parse(ApiConfig.parcelCancel(widget.tripId)),
              headers: headers,
              body: jsonEncode({'reason': reason}),
            )
            .timeout(const Duration(seconds: 10));
        httpCancelOk = res.statusCode == 200;
      } catch (e, st) {
        reportSilentFailure('TrackingScreen._cancelTrip(parcel)', e, st);
      }
      if (!mounted) return;
      if (!httpCancelOk) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Cancellation sent, but we could not confirm it reached the server. Check My Trips to be sure.'),
          backgroundColor: JT.primaryDark,
          behavior: SnackBarBehavior.floating,
        ));
        await Future.delayed(const Duration(seconds: 2));
        if (!mounted) return;
      }
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const MainScreen()),
        (_) => false,
      );
      return;
    }

    // Cancel via socket first
    _socket.cancelTrip(_trip?['id']?.toString() ?? widget.tripId);
    // Also HTTP for persistence
    double? walletRefund;
    bool httpCancelOk = false;
    try {
      final headers = await AuthService.getHeaders();
      final res = await http.post(Uri.parse(ApiConfig.cancelTrip),
          headers: headers,
          body: jsonEncode(
              {'tripId': _trip?['id'] ?? widget.tripId, 'reason': reason})).timeout(const Duration(seconds: 10));
      httpCancelOk = res.statusCode == 200;
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        walletRefund = double.tryParse(data['walletRefund']?.toString() ?? '');
      }
    } catch (e, st) {
      reportSilentFailure('TrackingScreen._cancelTrip', e, st);
    }
    if (!mounted) return;
    if (walletRefund != null && walletRefund > 0) {
      _showStatusBanner(
          '₹${walletRefund.toStringAsFixed(0)} refunded to your wallet',
          JT.primary);
      await Future.delayed(const Duration(seconds: 2));
    } else if (!httpCancelOk) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'Cancellation sent, but we could not confirm it reached the server. Check My Trips to be sure.'),
        backgroundColor: JT.primaryDark,
        behavior: SnackBarBehavior.floating,
      ));
      await Future.delayed(const Duration(seconds: 2));
    }
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(context,
        MaterialPageRoute(builder: (_) => const MainScreen()), (_) => false);
  }


  void _showCancelDialog() {
    final reasons = _cancelReasons.isNotEmpty
        ? _cancelReasons
        : [
            'Driver is taking too long',
            'I booked by mistake',
            'Changed travel plans',
            'Other reason',
          ];

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (_) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 18),
              decoration: BoxDecoration(
                  color: JT.border, borderRadius: BorderRadius.circular(2))),
          Row(
            children: [
              Expanded(
                child: Text('Cancel Ride',
                    style: GoogleFonts.poppins(
                        fontSize: 19, fontWeight: FontWeight.w700, color: JT.textPrimary)),
              ),
              GestureDetector(
                onTap: () => Navigator.pop(context),
                child: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9), shape: BoxShape.circle),
                  child: const Icon(Icons.close_rounded, size: 18, color: Color(0xFF64748B)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Align(
            alignment: Alignment.centerLeft,
            child: Text('Please tell us the reason for cancelling',
                style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary)),
          ),
          const SizedBox(height: 18),
          ...reasons.map((r) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: GestureDetector(
                  onTap: () {
                    Navigator.pop(context);
                    _cancelTrip(r);
                  },
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFF0F1F3)),
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: JT.primary.withValues(alpha: 0.08),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(_iconForCancelReason(r), size: 16, color: JT.primary),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(r,
                              style: GoogleFonts.poppins(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w500,
                                  color: JT.textPrimary)),
                        ),
                        Container(
                          width: 18,
                          height: 18,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(color: const Color(0xFFCBD5E1), width: 1.5),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              )),
        ]),
      ),
    );
  }

  IconData _iconForCancelReason(String reason) {
    final r = reason.toLowerCase();
    if (r.contains('far') || r.contains('distance')) return Icons.social_distance_rounded;
    if (r.contains('long') || r.contains('wait') || r.contains('time') || r.contains('taking')) {
      return Icons.hourglass_bottom_rounded;
    }
    if (r.contains('mistake') || r.contains('chang') || r.contains('plan')) {
      return Icons.swap_horiz_rounded;
    }
    return Icons.more_horiz_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final statusInfo = _getStatusInfo(_status);
    final trip = _trip;
    final otp =
        trip?['pickupOtp']?.toString() ?? trip?['pickup_otp']?.toString();
    final driverName =
        trip?['driverName']?.toString() ?? trip?['driver_name']?.toString() ?? (_status != 'searching' ? 'Jago Pilot' : null);
    final driverPhone =
        trip?['driverPhone']?.toString() ?? trip?['driver_phone']?.toString();
    final driverRating = trip?['driverRating'] ?? trip?['driver_rating'];
    final driverPhoto =
        trip?['driverPhoto']?.toString() ?? trip?['driver_photo']?.toString();
    final actualFare = trip?['actualFare'] ?? trip?['actual_fare'];
    final estimatedFare = trip?['estimatedFare'] ?? trip?['estimated_fare'];

    final panelBg = JT.surface;

    return PopScope(
      canPop: false, // Prevent all back gestures/buttons during active tracking
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (_status == 'completed' || _status == 'cancelled') {
          Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (_) => const MainScreen()),
              (_) => false);
        } else {
          // Show a hint that they can't leave
          _showStatusBanner('Active trip in progress', JT.primary);
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFF0F7FF),
        body: Column(
          children: [
            // Global Header
            SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    GestureDetector(
                      onTap: () {
                        if (_status == 'completed' || _status == 'cancelled') {
                          Navigator.of(context).pushAndRemoveUntil(
                              MaterialPageRoute(builder: (_) => const MainScreen()),
                              (_) => false);
                        }
                      },
                      child: JT.logoBlue(height: 56),
                    ),
                    Row(
                      children: [
                        _headerAction(Icons.shield_rounded, 'Safety'),
                        const SizedBox(width: 12),
                        _headerAction(Icons.headset_mic_rounded, 'Support'),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            Expanded(
              child: Container(
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
                ),
                child: ClipRRect(
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
                  child: Stack(children: [
                    GoogleMap(
                      initialCameraPosition: CameraPosition(target: _center, zoom: 15),
                      style: Theme.of(context).brightness == Brightness.dark ? kMapNightStyle : null,
                      onMapCreated: (c) {
                        _mapController = c;
                        // Always refresh markers/camera on map creation — previously
                        // gated on _driverLatLng, so during 'searching' (no driver
                        // yet) the map kept its hardcoded default camera position
                        // instead of centering on the actual pickup point.
                        _updateMapMarkers();
                        if (_driverLatLng != null) {
                          _fetchRouteForStatus();
                        }
                      },
                      markers: _markers,
                      polylines: {
                        if (_fullTripRoutePoints != null &&
                            (_status == 'in_progress' ||
                                _status == 'on_the_way'))
                          Polyline(
                            polylineId: const PolylineId('full_trip_route'),
                            points: _fullTripRoutePoints!,
                            color: JT.primary.withValues(alpha: 0.22),
                            width: 4,
                            jointType: JointType.round,
                            startCap: Cap.roundCap,
                            endCap: Cap.roundCap,
                          ),
                        ..._polylines,
                      },
                      circles: {
                        if (_status == 'searching' && _trip != null)
                          Circle(
                            circleId: const CircleId('search_radius'),
                            center: LatLng(
                                double.tryParse(_trip?['pickupLat']?.toString() ?? '0') ??
                                    0,
                                double.tryParse(_trip?['pickupLng']?.toString() ?? '0') ??
                                    0),
                            radius: 400,
                            fillColor: const Color(0xFF2F7BFF).withValues(alpha: 0.05),
                            strokeColor: const Color(0xFF2F7BFF).withValues(alpha: 0.3),
                            strokeWidth: 2,
                          ),
                      },
                      myLocationEnabled: true,
                      zoomControlsEnabled: false,
                      mapToolbarEnabled: false,
                    ),
                    Positioned(
                      bottom: 0,
                      left: 0,
                      right: 0,
                      child: Container(
                        constraints: _isDraggablePanelStatus
                            ? BoxConstraints(
                                minHeight: MediaQuery.of(context).size.height *
                                    _draggablePanelHeightFraction,
                                maxHeight: MediaQuery.of(context).size.height *
                                    _draggablePanelHeightFraction,
                              )
                            : BoxConstraints(
                                maxHeight: MediaQuery.of(context).size.height * 0.62),
                        decoration: BoxDecoration(
                          color: panelBg,
                          borderRadius:
                              const BorderRadius.vertical(top: Radius.circular(28)),
                          boxShadow: const [
                            BoxShadow(color: Color(0x22000000), blurRadius: 24)
                          ],
                        ),
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onVerticalDragUpdate: _isDraggablePanelStatus
                                ? (details) {
                                    final screenH =
                                        MediaQuery.of(context).size.height;
                                    setState(() {
                                      _draggablePanelHeightFraction =
                                          (_draggablePanelHeightFraction -
                                                  details.delta.dy / screenH)
                                              .clamp(0.18, 0.78);
                                    });
                                  }
                                : null,
                            child: Container(
                              width: double.infinity,
                              height: 32,
                              alignment: Alignment.center,
                              color: Colors.transparent,
                              child: Container(
                                  width: 44,
                                  height: 5,
                                  decoration: BoxDecoration(
                                      color: _isDraggablePanelStatus
                                          ? const Color(0xFFCBD5E1)
                                          : JT.border,
                                      borderRadius: BorderRadius.circular(3))),
                            ),
                          ),
                          Flexible(
                              child: SingleChildScrollView(
                            physics: const ClampingScrollPhysics(),
                            child: Padding(
                              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
                              child: _status == 'searching'
                                  ? _buildSearchingView(trip, actualFare, estimatedFare)
                                  : _status == 'cancelled'
                                      ? _buildCancelledCard()
                                      : Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        _buildPremiumHeader(statusInfo, otp, driverName),
                                        const SizedBox(height: 14),
                                        if (driverName != null)
                                          _buildPremiumDriverCard(
                                            name: driverName,
                                            rating: driverRating,
                                            photo: driverPhoto,
                                            vehicleNum: trip?['driverVehicleNumber'] ?? '',
                                            vehicleModel: trip?['driverVehicleModel'] ?? '',
                                            phone: driverPhone,
                                          )
                                        else
                                          const Center(
                                              child: Padding(
                                            padding: EdgeInsets.symmetric(vertical: 20),
                                            child:
                                                CircularProgressIndicator(strokeWidth: 2),
                                          )),
                                        const SizedBox(height: 16),
                                        if (trip != null) ...[
                                          if (_status == 'in_progress' ||
                                              _status == 'on_the_way')
                                            _buildInProgressPanel(trip)
                                          else if (_status == 'accepted' ||
                                              _status == 'driver_assigned' ||
                                              _status == 'arrived')
                                            _buildHeadingToYouPanel(trip)
                                          else ...[
                                            _buildFareRow(trip, actualFare, estimatedFare),
                                          ],
                                        ],
                                        if (_status == 'completed') ...[
                                          const SizedBox(height: 40),
                                          const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                                          const SizedBox(height: 20),
                                          Center(child: Text('Ending your trip...', style: GoogleFonts.poppins(color: JT.textSecondary))),
                                        ],
                                        // Cancel Ride now lives in the header's
                                        // "more" menu (see _buildMoreMenuButton)
                                        // instead of a separate inline button.
                                      ]),
                            ),
                          )),
                        ]),
                      ),
                    ),

                    // --- Premium Top Status Banner ---
                    if (_bannerMessage != null)
                      AnimatedPositioned(
                        duration: const Duration(milliseconds: 400),
                        curve: Curves.easeOutBack,
                        top: 12,
                        left: 20,
                        right: 20,
                        child: _buildTopBannerWidget(),
                      ),
                  ]),
                ),
              ),
            ),
          ],
        ),
        bottomNavigationBar: _buildBottomNav(),
      ),
    );
  }

  void _startInAppCall(String driverName) {
    final driverId =
        _trip?['driverId']?.toString() ?? _trip?['driver_id']?.toString();
    if (driverId != null && driverId.isNotEmpty) {
      Navigator.of(context).push(MaterialPageRoute(
        builder: (_) => CallScreen(
          contactName: driverName,
          tripId: widget.tripId,
          targetUserId: driverId,
        ),
      ));
    } else if ((_trip?['driverPhone'] ?? _trip?['driver_phone']) != null) {
      launchUrl(
          Uri.parse('tel:${_trip!['driverPhone'] ?? _trip!['driver_phone']}'));
    }
  }

  // ── Premium UI Components ──────────────────────────────────────────────────

  Widget _buildPremiumHeader(
      Map<String, dynamic> statusInfo, String? otp, String? driverName) {
    final showOtp = otp != null &&
        otp.isNotEmpty &&
        (_status == 'driver_assigned' ||
            _status == 'accepted' ||
            _status == 'arrived');
    final eta = _trip?['etaMinutes']?.toString() ?? '5';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    statusInfo['label'] as String,
                    style: GoogleFonts.poppins(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F172A),
                    ),
                  ),
                  if (_status != 'completed' &&
                      _status != 'cancelled' &&
                      _status != 'searching')
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Live tracking',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                        Text(
                          '  •  ',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                        Text(
                          'Secure',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: JT.primary,
                          ),
                        ),
                        const SizedBox(width: 3),
                        Icon(Icons.verified_user_rounded,
                            size: 12, color: JT.primary),
                      ],
                    ),
                ],
              ),
            ),
            if (_status != 'searching' &&
                _status != 'completed' &&
                _status != 'cancelled')
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    onPressed: _shareRide,
                    icon: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF1F5F9),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.share_rounded,
                          size: 18, color: Color(0xFF475569)),
                    ),
                  ),
                  _buildMoreMenuButton(driverName),
                ],
              ),
          ],
        ),
        if (showOtp) ...[
          const SizedBox(height: 16),
          Row(
            children: [
              // PIN Card
              Expanded(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: const Color(0xFF6366F1).withValues(alpha: 0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.lock_rounded,
                            color: Color(0xFF6366F1), size: 18),
                      ),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('SECURE PIN',
                              style: GoogleFonts.poppins(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: const Color(0xFF94A3B8))),
                          Text(otp,
                              style: GoogleFonts.poppins(
                                  fontSize: 22,
                                  fontWeight: FontWeight.w800,
                                  color: const Color(0xFF0F172A),
                                  letterSpacing: 1)),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Wait Time Card
              Expanded(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: const Color(0xFF10B981).withValues(alpha: 0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.timer_rounded,
                            color: Color(0xFF10B981), size: 18),
                      ),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('PILOT ARRIVES IN',
                              style: GoogleFonts.poppins(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: const Color(0xFF94A3B8))),
                          Text('$eta MIN',
                              style: GoogleFonts.poppins(
                                  fontSize: 20,
                                  fontWeight: FontWeight.w800,
                                  color: const Color(0xFF0F172A))),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildMoreMenuButton(String? driverName) {
    final canCancel =
        _status != 'arrived' && _status != 'in_progress' && _status != 'on_the_way';
    return PopupMenuButton<String>(
      tooltip: '',
      padding: EdgeInsets.zero,
      offset: const Offset(0, 44),
      elevation: 6,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      icon: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          shape: BoxShape.circle,
        ),
        child: const Icon(Icons.more_vert_rounded, size: 18, color: Color(0xFF475569)),
      ),
      onSelected: (value) {
        switch (value) {
          case 'cancel':
            _showCancelDialog();
            break;
          case 'contact':
            if (driverName != null) _startInAppCall(driverName);
            break;
          case 'help':
            Navigator.push(context,
                MaterialPageRoute(builder: (_) => const SupportChatScreen()));
            break;
        }
      },
      itemBuilder: (context) => [
        if (canCancel)
          PopupMenuItem(
            value: 'cancel',
            child: Row(children: [
              const Icon(Icons.cancel_rounded, size: 18, color: Color(0xFFDC2626)),
              const SizedBox(width: 10),
              Text('Cancel Ride',
                  style: GoogleFonts.poppins(
                      fontSize: 13, fontWeight: FontWeight.w500, color: const Color(0xFFDC2626))),
            ]),
          ),
        PopupMenuItem(
          value: 'contact',
          child: Row(children: [
            const Icon(Icons.headset_mic_rounded, size: 18, color: Color(0xFF475569)),
            const SizedBox(width: 10),
            Text('Contact Pilot',
                style: GoogleFonts.poppins(
                    fontSize: 13, fontWeight: FontWeight.w500, color: const Color(0xFF334155))),
          ]),
        ),
        PopupMenuItem(
          value: 'help',
          child: Row(children: [
            const Icon(Icons.help_outline_rounded, size: 18, color: Color(0xFF475569)),
            const SizedBox(width: 10),
            Text('Help & Support',
                style: GoogleFonts.poppins(
                    fontSize: 13, fontWeight: FontWeight.w500, color: const Color(0xFF334155))),
          ]),
        ),
      ],
    );
  }

  IconData _iconForVehicleLabel(String label) {
    final l = label.toLowerCase();
    if (l.contains('bike') || l.contains('two')) return Icons.two_wheeler_rounded;
    if (l.contains('auto') || l.contains('rickshaw')) return Icons.electric_rickshaw_rounded;
    if (l.contains('parcel') || l.contains('truck') || l.contains('shipping')) {
      return Icons.local_shipping_rounded;
    }
    return Icons.directions_car_filled_rounded;
  }

  Widget _buildPremiumDriverCard({
    required String name,
    required dynamic rating,
    required String? photo,
    required String vehicleNum,
    required String vehicleModel,
    required String? phone,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.primary.withValues(alpha: 0.08), width: 1),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.03),
              blurRadius: 10,
              offset: const Offset(0, 4)),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: JT.border,
              shape: BoxShape.circle,
              image: photo != null && photo.isNotEmpty
                  ? DecorationImage(
                      image: NetworkImage(photo), fit: BoxFit.cover)
                  : null,
            ),
            child: (photo == null || photo.isEmpty)
                ? const Icon(Icons.person_rounded,
                    color: Colors.white, size: 26)
                : null,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        name,
                        style: GoogleFonts.poppins(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w600,
                          color: JT.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: Colors.green[50],
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.star_rounded,
                              color: Colors.green, size: 11),
                          const SizedBox(width: 2),
                          Text(
                            rating?.toString() ?? '4.8',
                            style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: Colors.green),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 5),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: JT.border, width: 1),
                  ),
                  child: Text(
                    vehicleNum.isNotEmpty ? vehicleNum.toUpperCase() : '...',
                    style: GoogleFonts.poppins(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: JT.textPrimary,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  vehicleModel.isNotEmpty ? vehicleModel : 'Jago Pilot',
                  style: GoogleFonts.poppins(
                      fontSize: 11, color: JT.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFF),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: JT.primary.withValues(alpha: 0.12)),
                ),
                child: Icon(_iconForVehicleLabel(_resolveVehicleLabel()),
                    color: JT.primary, size: 20),
              ),
              const SizedBox(height: 5),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                decoration: BoxDecoration(
                  color: JT.primary,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.check_rounded,
                        color: Colors.white, size: 10),
                    const SizedBox(width: 2),
                    Text('Verified',
                        style: GoogleFonts.poppins(
                            fontSize: 8.5,
                            fontWeight: FontWeight.w600,
                            color: Colors.white)),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSearchingView(Map<String, dynamic>? trip, dynamic actualFare, dynamic estimatedFare) {
    final rawFare = actualFare ?? estimatedFare;
    final rawFareNum = double.tryParse(rawFare?.toString() ?? '');
    final fallbackFare = widget.initialFareEstimate;
    // Server hasn't attached a real fare to this trip yet (or reported 0) —
    // show the same fare the customer already saw on the booking/confirm
    // screen instead of a bare "₹0.000".
    final fareVal = (rawFareNum == null || rawFareNum <= 0) &&
            fallbackFare != null &&
            fallbackFare > 0
        ? fallbackFare.toStringAsFixed(2)
        : rawFare;
    final dist = trip?['estimatedDistance'] ?? trip?['estimated_distance'];
    final duration = trip?['estimatedDurationMinutes'] ?? trip?['estimated_duration'] ?? trip?['etaMinutes'];
    final eta = trip?['etaMinutes']?.toString() ?? '2';

    return Column(
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
                    'Finding you the best ride',
                    style: GoogleFonts.poppins(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F172A),
                      height: 1.15,
                      letterSpacing: -0.2,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    "We're finding nearby riders and will match you soon.",
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.poppins(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w400,
                      color: const Color(0xFF64748B),
                      height: 1.25,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  eta,
                  style: GoogleFonts.poppins(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: const Color(0xFF2C95F1),
                    height: 1.0,
                  ),
                ),
                Text(
                  'min away',
                  style: GoogleFonts.poppins(
                    fontSize: 9,
                    fontWeight: FontWeight.w500,
                    color: const Color(0xFF64748B),
                  ),
                ),
              ],
            ),
          ],
        ),
        const SizedBox(height: 8),
        _buildSearchLivePill(),
        const SizedBox(height: 8),
        _buildSearchStages(),
        const SizedBox(height: 8),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _buildEstimatedFareCard(fareVal, dist, duration)),
            const SizedBox(width: 8),
            Expanded(child: _buildAddFareAmountCard()),
          ],
        ),
        const SizedBox(height: 10),
        _buildSearchCancelButton(),
        const SizedBox(height: 6),
        _buildSafetyFooter(),
      ],
    );
  }

  // Pulsing radar-style icon that signals an active, ongoing search.
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
                    decoration: const BoxDecoration(
                      color: Color(0xFF2C95F1),
                      shape: BoxShape.circle,
                    ),
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
          decoration: BoxDecoration(
            color: const Color(0xFF2C95F1).withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.search_rounded, color: Color(0xFF2C95F1), size: 16),
        ),
      ),
    );
  }

  Widget _buildSearchLivePill() {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.3)),
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
                    color: const Color(0xFF10B981)
                        .withValues(alpha: 0.5 + _pulseCtrl.value * 0.5),
                    shape: BoxShape.circle,
                  ),
                ),
              ),
              const SizedBox(width: 5),
              Text(
                'Live',
                style: GoogleFonts.poppins(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF10B981),
                ),
              ),
              const SizedBox(width: 5),
              Text('|', style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFFCBD5E1))),
              const SizedBox(width: 5),
              Text(
                '${_nearbyDrivers.length} pilots nearby',
                style: GoogleFonts.poppins(
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                  color: const Color(0xFF64748B),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // Animated 3-step tracker: Searching -> Verifying -> Matching.
  // Cosmetic only — loops continuously while the real dispatch search runs.
  Widget _buildSearchStages() {
    final steps = <(IconData, String)>[
      (Icons.groups_rounded, 'Searching\nnearby riders'),
      (Icons.verified_user_rounded, 'Verifying\navailability'),
      (Icons.task_alt_rounded, 'Matching\nbest ride'),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF0F1F3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < steps.length; i++) ...[
            _buildSearchStageStep(
              steps[i].$1,
              steps[i].$2,
              active: i == _searchStage,
              done: i < _searchStage,
            ),
            if (i != steps.length - 1)
              Expanded(child: _buildSearchStageConnector(i < _searchStage)),
          ],
        ],
      ),
    );
  }

  Widget _buildSearchStageStep(IconData icon, String label,
      {required bool active, required bool done}) {
    final color = done
        ? const Color(0xFF10B981)
        : (active ? const Color(0xFF2C95F1) : const Color(0xFF9CA3AF));
    final bg = done
        ? const Color(0xFF10B981).withValues(alpha: 0.12)
        : (active
            ? const Color(0xFF2C95F1).withValues(alpha: 0.12)
            : const Color(0xFFE5E7EB).withValues(alpha: 0.5));
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
            child: Icon(done ? Icons.check_rounded : icon,
                size: active ? 14 : 11, color: color),
          ),
          const SizedBox(height: 5),
          Text(
            label,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              fontSize: 8.5,
              fontWeight: active ? FontWeight.w600 : FontWeight.w500,
              color: active || done ? const Color(0xFF334155) : const Color(0xFF9CA3AF),
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
        color: done ? const Color(0xFF10B981).withValues(alpha: 0.5) : const Color(0xFFE5E7EB),
        borderRadius: BorderRadius.circular(1),
      ),
    );
  }

  Widget _buildEstimatedFareCard(dynamic fareVal, dynamic dist, dynamic duration) {
    final baseFare = double.tryParse(fareVal?.toString() ?? '');
    final addon = _selectedFareAddon;
    final hasAddon = addon != null && addon > 0;
    final total = hasAddon ? (baseFare ?? 0) + addon : null;

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF0F1F3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Estimated Fare',
              style: GoogleFonts.poppins(
                  fontSize: 10, fontWeight: FontWeight.w500, color: const Color(0xFF64748B))),
          const SizedBox(height: 4),
          Text(
            total != null
                ? '₹${total.toStringAsFixed(2)}'
                : (fareVal != null ? '₹$fareVal' : '--'),
            style: GoogleFonts.poppins(
                fontSize: 16, fontWeight: FontWeight.w800, color: const Color(0xFF0F172A)),
          ),
          if (hasAddon) ...[
            const SizedBox(height: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(7),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.add_rounded, size: 10, color: Color(0xFF10B981)),
                  Text(
                    '₹$addon added',
                    style: GoogleFonts.poppins(
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                      color: const Color(0xFF10B981),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (dist != null || duration != null) ...[
            const SizedBox(height: 6),
            Wrap(
              spacing: 5,
              runSpacing: 5,
              children: [
                if (dist != null) _buildTripDetailPill(Icons.route_outlined, '${_formatKm(dist)} km'),
                if (duration != null)
                  _buildTripDetailPill(Icons.access_time_rounded, '$duration min'),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildTripDetailPill(IconData icon, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFF2C95F1).withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF2C95F1).withValues(alpha: 0.18)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 10, color: const Color(0xFF2C95F1)),
          const SizedBox(width: 3),
          Text(
            text,
            style: GoogleFonts.poppins(
              fontSize: 9.5,
              fontWeight: FontWeight.w600,
              color: const Color(0xFF1E40AF),
            ),
          ),
        ],
      ),
    );
  }

  // UI-only "Add Fare Amount" picker — no backend wiring yet.
  Widget _buildAddFareAmountCard() {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF0F1F3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Add Fare Amount',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(
                      fontSize: 10, fontWeight: FontWeight.w500, color: const Color(0xFF64748B)),
                ),
              ),
              const Icon(Icons.info_outline_rounded, size: 12, color: Color(0xFF9CA3AF)),
            ],
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 5,
            runSpacing: 5,
            children: [
              for (final amt in _fareAmountPresets) _buildFareAmountChip(amt),
              _buildFareAmountCustomChip(),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFareAmountChip(int amt) {
    final selected = _selectedFareAddon == amt;
    return GestureDetector(
      onTap: () => setState(() => _selectedFareAddon = selected ? null : amt),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF2C95F1) : Colors.white,
          borderRadius: BorderRadius.circular(9),
          border: Border.all(color: selected ? const Color(0xFF2C95F1) : const Color(0xFFE5E7EB)),
        ),
        child: Text(
          '₹$amt',
          style: GoogleFonts.poppins(
            fontSize: 10.5,
            fontWeight: FontWeight.w600,
            color: selected ? Colors.white : const Color(0xFF0F172A),
          ),
        ),
      ),
    );
  }

  Widget _buildFareAmountCustomChip() {
    final isCustom =
        _selectedFareAddon != null && !_fareAmountPresets.contains(_selectedFareAddon);
    return GestureDetector(
      onTap: _promptCustomFareAmount,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          color: isCustom ? const Color(0xFF2C95F1) : Colors.white,
          borderRadius: BorderRadius.circular(9),
          border: Border.all(color: isCustom ? const Color(0xFF2C95F1) : const Color(0xFFE5E7EB)),
        ),
        child: isCustom
            ? Text('₹$_selectedFareAddon',
                style: GoogleFonts.poppins(
                    fontSize: 10.5, fontWeight: FontWeight.w600, color: Colors.white))
            : const Icon(Icons.add_rounded, size: 14, color: Color(0xFF0F172A)),
      ),
    );
  }

  // Local-only amount entry — persisting/sending this is not wired up yet.
  Future<void> _promptCustomFareAmount() async {
    final controller = TextEditingController(
      text: (_selectedFareAddon != null && !_fareAmountPresets.contains(_selectedFareAddon))
          ? _selectedFareAddon.toString()
          : '',
    );
    final result = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                      color: const Color(0xFFE5E7EB), borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 18),
              Text('Add Fare Amount',
                  style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text('Enter a custom amount to add to your fare',
                  style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF64748B))),
              const SizedBox(height: 16),
              TextField(
                controller: controller,
                autofocus: true,
                keyboardType: TextInputType.number,
                style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600),
                decoration: InputDecoration(
                  prefixText: '₹ ',
                  filled: true,
                  fillColor: const Color(0xFFF8FAFC),
                  border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                ),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2C95F1),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  onPressed: () => Navigator.pop(ctx, int.tryParse(controller.text.trim())),
                  child: Text('Add',
                      style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (result != null && result > 0 && mounted) {
      setState(() => _selectedFareAddon = result);
    }
  }

  Widget _buildSearchCancelButton() {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: _showCancelDialog,
        icon: const Icon(Icons.close_rounded, size: 15, color: Color(0xFFDC2626)),
        label: Text(
          'Cancel Ride',
          style: GoogleFonts.poppins(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: const Color(0xFFDC2626),
          ),
        ),
        style: OutlinedButton.styleFrom(
          padding: const EdgeInsets.symmetric(vertical: 10),
          side: BorderSide(color: const Color(0xFFDC2626).withValues(alpha: 0.4)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      ),
    );
  }

  Widget _buildSafetyFooter() {
    return Center(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.lock_outline_rounded, size: 11, color: Color(0xFF9CA3AF)),
          const SizedBox(width: 5),
          Text(
            'Your safety is our priority. All rides are monitored.',
            style: GoogleFonts.poppins(fontSize: 9.5, color: const Color(0xFF9CA3AF)),
          ),
        ],
      ),
    );
  }


  Future<void> _shareRide() async {
    final tripId = widget.tripId;
    final shareText =
        '🚗 Track my JAGO ride!\nLive location: https://jagopro.org/track/$tripId\nDownload Jago: https://jagopro.org/download';
    final encoded = Uri.encodeComponent(shareText);
    final uri = Uri.parse('whatsapp://send?text=$encoded');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    } else {
      await Clipboard.setData(ClipboardData(text: shareText));
      if (mounted)
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
            content: Text('Share text copied! Paste in WhatsApp'),
            backgroundColor: JT.primary));
    }
  }

  Future<void> _triggerSos() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('🚨 SOS Alert',
            style: TextStyle(fontWeight: FontWeight.w500)),
        content: const Text(
            'Send an Emergency SOS? Our help team will contact you immediately.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: JT.primary),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Send SOS',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w500))),
        ],
      ),
    );
    if (confirm != true) return;

    final sent = await _sendSosPing(message: 'Customer SOS alert during trip');
    if (!mounted) return;
    if (sent) {
      setState(() => _sosActive = true);
      // No dedicated "update alert location" endpoint exists on the backend -
      // this keeps tracking "continuous" without an API contract change by
      // re-posting to the same /api/app/sos endpoint on a timer, creating a
      // chronological trail of alert rows the admin can follow for this trip.
      _sosTimer?.cancel();
      _sosTimer = Timer.periodic(const Duration(seconds: 20), (_) {
        _sendSosPing(message: 'SOS location update');
      });
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('🚨 SOS Alert sent! Help is on the way.',
            style: TextStyle(fontWeight: FontWeight.w400)),
        backgroundColor: JT.primary,
        behavior: SnackBarBehavior.floating,
      ));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('SOS failed. Call 100 immediately!',
            style: TextStyle(fontWeight: FontWeight.w400)),
        backgroundColor: JT.primaryDark,
        behavior: SnackBarBehavior.floating,
      ));
    }
  }

  Future<bool> _sendSosPing({required String message}) async {
    try {
      final sosHeaders = await AuthService.getHeaders();
      await http.post(Uri.parse(ApiConfig.sos),
          headers: {...sosHeaders, 'Content-Type': 'application/json'},
          body: jsonEncode({
            'tripId': widget.tripId,
            'lat': _center.latitude,
            'lng': _center.longitude,
            'message': message,
          })).timeout(const Duration(seconds: 10));
      return true;
    } catch (e, st) {
      reportSilentFailure('TrackingScreen._sendSosPing', e, st);
      return false;
    }
  }

  Future<void> _confirmStopSos() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Stop SOS tracking?',
            style: TextStyle(fontWeight: FontWeight.w500)),
        content: const Text(
            'This stops sending your live location to our safety team for this alert.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Keep Active')),
          ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: JT.primary),
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Stop',
                  style: TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w500))),
        ],
      ),
    );
    if (confirm == true) _stopSos();
  }

  void _stopSos() {
    _sosTimer?.cancel();
    _sosTimer = null;
    if (!mounted) return;
    setState(() => _sosActive = false);
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('SOS tracking stopped.',
          style: TextStyle(fontWeight: FontWeight.w400)),
      behavior: SnackBarBehavior.floating,
    ));
  }

  Widget _buildFareRow(
      Map<String, dynamic> trip, dynamic actualFare, dynamic estimatedFare) {
    final rawFare = actualFare ?? estimatedFare;
    final rawFareNum = double.tryParse(rawFare?.toString() ?? '');
    final fallbackFare = widget.initialFareEstimate;
    // Same fallback as the searching screen — show the fare the customer
    // already saw at booking if the trip hasn't got a real one attached yet.
    final fareVal = (rawFareNum == null || rawFareNum <= 0) &&
            fallbackFare != null &&
            fallbackFare > 0
        ? fallbackFare.toStringAsFixed(2)
        : rawFare;
    final dist = trip['estimatedDistance'] ?? trip['estimated_distance'];
    final vehicle = trip['vehicleName'] ?? trip['vehicle_name'];
    return Row(
      children: [
        Expanded(
          child: _labeledChip('FARE', fareVal != null ? '₹$fareVal' : '--',
              Icons.currency_rupee_rounded, const Color(0xFF10B981)),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _labeledChip('DISTANCE', dist != null ? '${_formatKm(dist)} km' : '--',
              Icons.route_rounded, const Color(0xFF6B7280)),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: _labeledChip('VEHICLE', vehicle?.toString() ?? '--',
              Icons.two_wheeler_rounded, const Color(0xFF6B7280)),
        ),
      ],
    );
  }

  Widget _labeledChip(String label, String value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.15)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 11, color: color),
              const SizedBox(width: 4),
              Text(label,
                  style: GoogleFonts.poppins(
                      fontSize: 9, fontWeight: FontWeight.w600, color: color)),
            ],
          ),
          const SizedBox(height: 3),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.poppins(
                fontSize: 13, fontWeight: FontWeight.w700, color: const Color(0xFF0F172A)),
          ),
        ],
      ),
    );
  }


  Widget _buildCancelledCard() {
    final reason =
        (_trip?['cancelReason'] ?? _trip?['cancel_reason'])?.toString() ?? '';
    final lowerReason = reason.toLowerCase();
    final isNoDriversFound = lowerReason.contains('no pilot') ||
        lowerReason.contains('no driver') ||
        lowerReason.contains('no delivery partner');
    final title = isNoDriversFound ? 'No rides available right now' : 'Trip Cancelled';
    final subtitle = isNoDriversFound
        ? "We couldn't find any riders for you. Please try again in a few moments."
        : (reason.isNotEmpty ? reason : 'This trip was cancelled.');

    return Column(
      children: [
        SizedBox(
          width: 84,
          height: 84,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: 62,
                height: 62,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF2C95F1).withValues(alpha: 0.06),
                  border: Border.all(color: const Color(0xFF2C95F1), width: 4.5),
                ),
                child: const Icon(Icons.sentiment_dissatisfied_rounded,
                    size: 30, color: Color(0xFF2C95F1)),
              ),
              Positioned(
                right: 2,
                bottom: 4,
                child: Transform.rotate(
                  angle: 0.78,
                  child: Container(
                    width: 20,
                    height: 6,
                    decoration: BoxDecoration(
                      color: const Color(0xFF2C95F1),
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Text(
          title,
          textAlign: TextAlign.center,
          style: GoogleFonts.poppins(
              fontSize: 18, fontWeight: FontWeight.w700, color: const Color(0xFF0F172A)),
        ),
        const SizedBox(height: 6),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: GoogleFonts.poppins(
              fontSize: 12.5, color: const Color(0xFF64748B), height: 1.4),
        ),
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.refresh_rounded, size: 18, color: Colors.white),
            label: Text('Try Again',
                style: GoogleFonts.poppins(
                    fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white)),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2C95F1),
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: const Color(0xFF2C95F1).withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.lightbulb_outline_rounded, size: 18, color: Color(0xFF2C95F1)),
              const SizedBox(width: 8),
              Expanded(
                child: RichText(
                  text: TextSpan(
                    style: GoogleFonts.poppins(
                        fontSize: 11.5, color: const Color(0xFF475569), height: 1.4),
                    children: [
                      TextSpan(
                        text: 'Tip: ',
                        style: TextStyle(
                            fontWeight: FontWeight.w700, color: const Color(0xFF1E293B)),
                      ),
                      const TextSpan(
                          text:
                              'You can try again after some time, or check different ride options.'),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _buildSafetyFooter(),
      ],
    );
  }

  Map<String, dynamic> _getStatusInfo(String status) {
    if (widget.isParcel) {
      switch (status) {
        case 'searching':
        case 'pending':
          return {
            'label': 'Finding a delivery partner...',
            'icon': Icons.radar_rounded,
            'color': JT.primary,
          };
        case 'driver_assigned':
        case 'accepted':
          return {
            'label': 'Partner assigned — heading to pickup',
            'icon': Icons.local_shipping_rounded,
            'color': JT.primary,
          };
        case 'picked_up':
          return {
            'label': 'Parcel picked up',
            'icon': Icons.inventory_2_rounded,
            'color': JT.success,
          };
        case 'in_transit':
          return {
            'label': 'Parcel on the way',
            'icon': Icons.navigation_rounded,
            'color': JT.primary,
          };
        case 'completed':
          return {
            'label': 'Parcel delivered',
            'icon': Icons.check_circle_rounded,
            'color': JT.success,
          };
        case 'cancelled':
          return {
            'label': 'Delivery cancelled',
            'icon': Icons.cancel_rounded,
            'color': JT.primaryDark,
          };
        default:
          return {
            'label': 'Tracking your parcel...',
            'icon': Icons.hourglass_empty_rounded,
            'color': const Color(0xFF94A3B8),
          };
      }
    }

    switch (status) {
      case 'searching':
        return {
          'label': 'Finding the best Pilot for you...',
          'icon': Icons.radar_rounded,
          'color': const Color(0xFF2D8CFF)
        };
      case 'driver_assigned':
      case 'accepted':
        return {
          'label': _isArriving
              ? 'Your pilot is about to arrive'
              : 'Ride Confirmed',
          'icon':
              _isArriving ? Icons.bolt_rounded : Icons.electric_bike_rounded,
          'color': const Color(0xFF2D8CFF)
        };
      case 'arrived':
        return {
          'label': 'Your pilot is arrived',
          'icon': Icons.location_on_rounded,
          'color': const Color(0xFF10B981)
        };
      case 'in_progress':
      case 'on_the_way':
        return {
          'label': 'Your ride is started',
          'icon': Icons.auto_awesome_rounded,
          'color': const Color(0xFF2D8CFF)
        };
      case 'completed':
        return {
          'label': 'Your ride is ended',
          'icon': Icons.check_circle_rounded,
          'color': JT.primary
        };
      case 'cancelled':
        return {
          'label': 'Trip Cancelled',
          'icon': Icons.cancel_rounded,
          'color': JT.primaryDark
        };
      default:
        return {
          'label': 'Loading...',
          'icon': Icons.hourglass_empty_rounded,
          'color': const Color(0xFF94A3B8)
        };
    }
  }

  void _animateToDestination() {
    Future.delayed(const Duration(milliseconds: 300), () {
      try {
        if (!mounted || _trip == null) return;
        final dLatStr = _trip?['destinationLat']?.toString() ??
            _trip?['destination_lat']?.toString() ??
            '';
        final dLngStr = _trip?['destinationLng']?.toString() ??
            _trip?['destination_lng']?.toString() ??
            '';

        final dLat = double.tryParse(dLatStr);
        final dLng = double.tryParse(dLngStr);

        if (dLat != null &&
            dLng != null &&
            dLat != 0 &&
            dLng != 0 &&
            _mapController != null) {
          debugPrint('[MAP] Animating to destination: $dLat, $dLng');
          _mapController!
              .animateCamera(CameraUpdate.newLatLngZoom(LatLng(dLat, dLng), 15))
              .catchError((e) {
            debugPrint('[MAP] Camera animation failed: $e');
          });
        }
      } catch (e) {
        debugPrint('[MAP] Error in _animateToDestination: $e');
      }
    });
  }

  void _showStatusBanner(String message, Color color) {
    if (!mounted) return;

    // Cancel existing timer if any
    _bannerTimer?.cancel();

    setState(() {
      _bannerMessage = message;
      _bannerColor = color;
    });

    // Auto-hide after 4 seconds
    _bannerTimer = Timer(const Duration(seconds: 4), () {
      if (mounted) {
        setState(() => _bannerMessage = null);
      }
    });
  }

  Widget _buildTopBannerWidget() {
    final isAlert = _bannerColor == Colors.red ||
        _bannerColor == const Color(0xFFDC2626) ||
        _bannerColor == Colors.orange;
    final badgeIcon = isAlert ? Icons.priority_high_rounded : Icons.check_rounded;
    final badgeInnerColor = isAlert ? _bannerColor : const Color(0xFF10B981);

    // Messages built as 'Title • Subtitle' render as a two-line banner,
    // matching the reference design; single-phrase messages stay one line.
    final parts = _bannerMessage!.split(' • ');
    final title = parts.first;
    final subtitle = parts.length > 1 ? parts.sublist(1).join(' • ') : null;

    return GestureDetector(
      onTap: () => setState(() => _bannerMessage = null),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: _bannerColor,
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: _bannerColor.withValues(alpha: 0.3),
              blurRadius: 15,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.25),
                shape: BoxShape.circle,
              ),
              child: Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: badgeInnerColor,
                  shape: BoxShape.circle,
                ),
                child: Icon(badgeIcon, color: Colors.white, size: 14),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.poppins(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                      letterSpacing: 0.2,
                    ),
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle,
                      style: GoogleFonts.poppins(
                        color: Colors.white.withValues(alpha: 0.9),
                        fontWeight: FontWeight.w400,
                        fontSize: 12.5,
                      ),
                    ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded,
                color: Colors.white.withValues(alpha: 0.85), size: 22),
          ],
        ),
      ),
    );
  }


  Widget _buildInProgressPanel(Map<String, dynamic> trip) {
    final dest = trip['destinationShortName'] ??
        trip['destinationAddress'] ??
        'Destination';
    final dist = trip['estimatedDistance'] ?? trip['estimated_distance'];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFF),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.blue.withValues(alpha: 0.1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                    color: Colors.blue.withValues(alpha: 0.12),
                    shape: BoxShape.circle),
                child: const Icon(Icons.navigation_rounded,
                    color: Colors.blue, size: 20),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Heading to',
                        style: GoogleFonts.poppins(
                            fontSize: 12, color: JT.textSecondary)),
                    Text(dest,
                        style: GoogleFonts.poppins(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: JT.textPrimary),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              if (dist != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                  decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: JT.border)),
                  child: Text('${_formatKm(dist)} km',
                      style: GoogleFonts.poppins(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: JT.primary)),
                ),
            ],
          ),
          const SizedBox(height: 16),
          const Divider(height: 1),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  _buildLiveDot(),
                  const SizedBox(width: 8),
                  Text('Trip is in progress',
                      style: GoogleFonts.poppins(
                          fontSize: 12,
                          color: Colors.green,
                          fontWeight: FontWeight.w600)),
                ],
              ),
              const Icon(Icons.security_rounded, color: Colors.blue, size: 18),
            ],
          ),
        ],
      ),
    );
  }

  // Server-reported distances arrive as raw doubles with long float noise
  // (e.g. 16.5165999999999997) — round to 1 decimal for display everywhere.
  String _formatKm(dynamic raw) {
    final km = double.tryParse(raw?.toString() ?? '');
    if (km == null) return raw?.toString() ?? '--';
    return km.toStringAsFixed(1);
  }

  String _formatDistanceAway(double km) {
    if (km < 1) return '${(km * 1000).round()} m away';
    return '${km.toStringAsFixed(1)} km away';
  }

  // Pre-pickup "heading to you" summary — mirrors _buildInProgressPanel's
  // layout/style but points at the pickup instead of the destination, using
  // the same driver location + pickup coordinates already tracked for the map.
  Widget _buildHeadingToYouPanel(Map<String, dynamic> trip) {
    final eta = trip['etaMinutes']?.toString() ?? '2';
    final pLat = double.tryParse(trip['pickupLat']?.toString() ?? '');
    final pLng = double.tryParse(trip['pickupLng']?.toString() ?? '');
    double? distKm;
    if (_driverLatLng != null && pLat != null && pLng != null) {
      distKm = _calculateDistance(
          _driverLatLng!.latitude, _driverLatLng!.longitude, pLat, pLng);
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFF),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: JT.primary.withValues(alpha: 0.1)),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
                color: JT.primary.withValues(alpha: 0.12),
                shape: BoxShape.circle),
            child: const Icon(Icons.navigation_rounded,
                color: JT.primary, size: 20),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Heading to you',
                    style: GoogleFonts.poppins(
                        fontSize: 12, color: JT.textSecondary)),
                const SizedBox(height: 2),
                Text.rich(
                  TextSpan(
                    style: GoogleFonts.poppins(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: JT.textPrimary),
                    children: [
                      const TextSpan(text: 'Arriving in '),
                      TextSpan(
                        text: '$eta min',
                        style: const TextStyle(
                            color: JT.primary, fontWeight: FontWeight.w700),
                      ),
                      if (distKm != null)
                        TextSpan(text: ' (${_formatDistanceAway(distKm)})'),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLiveDot() {
    return Container(
      width: 8,
      height: 8,
      decoration:
          const BoxDecoration(color: Colors.red, shape: BoxShape.circle),
    );
  }

  Widget _headerAction(IconData icon, String label) {
    return GestureDetector(
      onTap: () {
        if (_status == 'completed' || _status == 'cancelled') {
          Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (_) => const MainScreen()),
              (_) => false);
        } else {
          _showStatusBanner('Active trip in progress', JT.primary);
        }
      },
      child: Container(
        width: 60,
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 10, offset: const Offset(0, 4)),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: JT.textPrimary, size: 22),
            const SizedBox(height: 3),
            Text(
              label,
              style: GoogleFonts.poppins(
                fontSize: 10,
                fontWeight: FontWeight.w500,
                color: const Color(0xFF64748B),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomNav() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey.shade100, width: 1)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _navItem(0, Icons.home_rounded, Icons.home_outlined, 'Home'),
              _navItem(1, Icons.receipt_long_rounded, Icons.receipt_long_outlined, 'Trips'),
              _navItem(2, Icons.account_balance_wallet_rounded, Icons.account_balance_wallet_outlined, 'Wallet'),
              _navItem(3, Icons.person_rounded, Icons.person_outline_rounded, 'Profile'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(int index, IconData activeIcon, IconData inactiveIcon, String label) {
    bool isSelected = index == 0;
    return GestureDetector(
      onTap: () {
        if (_status == 'completed' || _status == 'cancelled') {
          Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (_) => const MainScreen()),
              (_) => false);
        } else {
          _showStatusBanner('Active trip in progress', JT.primary);
        }
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: isSelected
            ? BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF2C95F1), Color(0xFF6366F1)], 
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(color: const Color(0xFF2C95F1).withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4)),
                ],
              )
            : null,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              isSelected ? activeIcon : inactiveIcon,
              color: isSelected ? Colors.white : const Color(0xFF94A3B8),
              size: 22,
            ),
            if (isSelected) ...[
              const SizedBox(width: 8),
              Text(
                label,
                style: GoogleFonts.poppins(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
              ),
            ]
          ],
        ),
      ),
    );
  }
}
