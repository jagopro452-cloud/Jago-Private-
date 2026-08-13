import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import '../../config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import '../call/call_screen.dart';
import '../chat/trip_chat_sheet.dart';

class OutstationPoolTripScreen extends StatefulWidget {
  final Map<String, dynamic> ride;
  const OutstationPoolTripScreen({super.key, required this.ride});
  @override
  State<OutstationPoolTripScreen> createState() => _OutstationPoolTripScreenState();
}

class _OutstationPoolTripScreenState extends State<OutstationPoolTripScreen> {
  final SocketService _socket = SocketService();
  List<dynamic> _passengers = [];
  bool _loading = true;
  bool _actionLoading = false;
  Timer? _refreshTimer;

  Widget _buildSheetHandle() {
    return Container(
      width: 44,
      height: 4,
      decoration: BoxDecoration(
        color: _border,
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
            child: CircularProgressIndicator(color: _primary, strokeWidth: 2.5),
          ),
          const SizedBox(height: 14),
          Text(
            'Preparing shared journey controls...',
            style: GoogleFonts.poppins(fontSize: 13, color: _textSec),
          ),
        ],
      ),
    );
  }
  Timer? _locationTimer;
  StreamSubscription<Map<String, dynamic>>? _callIncomingSub;
  StreamSubscription<Map<String, dynamic>>? _poolBookingSub;
  StreamSubscription<Map<String, dynamic>>? _poolSeatSub;
  StreamSubscription<Map<String, dynamic>>? _poolStatusSub;

  static const _primary  = Color(0xFF2D8CFF);
  static const _bg       = Color(0xFFFFFFFF);
  static const _surface  = Color(0xFFF8FAFE);
  static const _border   = Color(0xFFE5E9F0);
  static const _green    = Color(0xFF16A34A);
  static const _amber    = Color(0xFFF59E0B);
  static const _red      = Color(0xFFDC2626);
  static const _textPri  = Color(0xFF111827);
  static const _textSec  = Color(0xFF6B7280);

  Map<String, dynamic> get _ride => widget.ride;
  String get _rideId => _ride['id']?.toString() ?? '';
  bool get _isScheduled => (_ride['status'] ?? '') == 'scheduled';
  bool get _isActive    => (_ride['status'] ?? '') == 'active';

  @override
  void initState() {
    super.initState();
    _loadPassengers();
    // Poll for new bookings every 30s (active trips need more frequent updates)
    _refreshTimer = Timer.periodic(
      Duration(seconds: _isActive ? 20 : 30),
      (_) => _loadPassengers(),
    );
    _callIncomingSub = _socket.onCallIncoming.listen((event) {
      final scope = event['callScope']?.toString();
      final poolModule = event['poolModule']?.toString();
      final referenceId = event['tripId']?.toString() ?? '';
      if (scope != 'pool' || poolModule != 'outstation_pool' || !mounted) return;
      final passenger = _passengers.cast<Map<String, dynamic>?>().firstWhere(
        (item) => item?['id']?.toString() == referenceId,
        orElse: () => null,
      );
      if (passenger == null) return;
      final callerId = event['callerId']?.toString() ?? '';
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CallScreen(
            contactName: event['callerName']?.toString() ?? passenger['passenger_name']?.toString() ?? 'Passenger',
            tripId: referenceId,
            targetUserId: callerId,
            isIncoming: true,
            callerIdForIncoming: callerId,
            callScope: 'pool',
            poolModule: 'outstation_pool',
          ),
        ),
      );
    });
    _poolBookingSub = _socket.onPoolNewPassenger.listen((event) {
      if ((event['module']?.toString() ?? '') != 'outstation_pool' || !mounted) return;
      final rideId = event['rideId']?.toString() ?? '';
      if (rideId.isNotEmpty && rideId != _rideId) return;
      _loadPassengers();
      _showSnack('New outstation pool booking synced', isSuccess: true);
    });
    _poolSeatSub = _socket.onPoolSeatUpdate.listen((event) {
      if ((event['module']?.toString() ?? '') != 'outstation_pool' || !mounted) return;
      final rideId = event['rideId']?.toString() ?? '';
      if (rideId.isNotEmpty && rideId != _rideId) return;
      _loadPassengers();
    });
    _poolStatusSub = _socket.onPoolStatus.listen((event) {
      if ((event['module']?.toString() ?? '') != 'outstation_pool' || !mounted) return;
      final rideId = event['rideId']?.toString() ?? '';
      if (rideId.isNotEmpty && rideId != _rideId) return;
      final nextStatus = event['status']?.toString() ?? '';
      if (nextStatus == 'active') {
        _ride['status'] = 'active';
        _startLocationUpdates();
      }
      _loadPassengers();
    });
    if (_isActive) _startLocationUpdates();
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    _locationTimer?.cancel();
    _callIncomingSub?.cancel();
    _poolBookingSub?.cancel();
    _poolSeatSub?.cancel();
    _poolStatusSub?.cancel();
    super.dispose();
  }

  Future<void> _loadPassengers() async {
    setState(() => _loading = true);
    try {
      final token = await AuthService.getToken();
      final res = await http.get(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/outstation-pool/rides/$_rideId/passengers'),
        headers: {'Authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        setState(() {
          _passengers = List<dynamic>.from(data['passengers'] ?? data ?? []);
          _loading = false;
        });
      } else {
        setState(() => _loading = false);
      }
    } catch (_) {
      setState(() => _loading = false);
    }
  }

  void _startLocationUpdates() {
    _locationTimer = Timer.periodic(const Duration(seconds: 8), (_) async {
      try {
        final pos = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
        ).timeout(const Duration(seconds: 5));
        final token = await AuthService.getToken();
        await http.patch(
          Uri.parse('${ApiConfig.baseUrl}/api/app/driver/outstation-pool/rides/$_rideId/location'),
          headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
          body: jsonEncode({'lat': pos.latitude, 'lng': pos.longitude}),
        ).timeout(const Duration(seconds: 5));
      } catch (_) { /* silent */ }
    });
  }

  Future<void> _startTrip() async {
    setState(() => _actionLoading = true);
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(const Duration(seconds: 5));
      final token = await AuthService.getToken();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/outstation-pool/rides/$_rideId/start'),
        headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
        body: jsonEncode({'lat': pos.latitude, 'lng': pos.longitude}),
      ).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        _ride['status'] = 'active';
        _startLocationUpdates();
        setState(() {});
        _showSnack('Trip started! Location sharing is active.', isSuccess: true);
      } else {
        final msg = jsonDecode(res.body)['message'] ?? 'Failed to start';
        _showSnack(msg, isSuccess: false);
      }
    } catch (e) {
      _showSnack('Error: $e', isSuccess: false);
    } finally {
      setState(() => _actionLoading = false);
    }
  }

  Future<void> _pickupPassenger(String bookingId, String name) async {
    final confirm = await _confirmDialog(
      'Confirm Pickup',
      'Pick up $name?',
      confirmLabel: 'Picked Up',
    );
    if (!confirm) return;

    setState(() => _actionLoading = true);
    try {
      final token = await AuthService.getToken();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/outstation-pool/passengers/$bookingId/pickup'),
        headers: {'Authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        _showSnack('$name picked up!', isSuccess: true);
        _loadPassengers();
      } else {
        _showSnack(jsonDecode(res.body)['message'] ?? 'Failed', isSuccess: false);
      }
    } catch (e) {
      _showSnack('Error: $e', isSuccess: false);
    } finally {
      setState(() => _actionLoading = false);
    }
  }

  Future<void> _dropPassenger(Map<String, dynamic> booking) async {
    final name     = booking['passenger_name'] ?? 'Passenger';
    final fare     = (booking['total_fare'] ?? 0.0) as num;
    final seats    = booking['seats_booked'] ?? 1;
    final segKm    = (booking['segment_km'] ?? 0.0) as num;
    final farePerSeat = (booking['fare_per_seat'] ?? 0.0) as num;

    // Show fare breakdown before confirming
    final confirm = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => _DropConfirmSheet(
        passengerName: name,
        seats: seats,
        farePerSeat: farePerSeat.toDouble(),
        totalFare: fare.toDouble(),
        segmentKm: segKm.toDouble(),
        dropAddress: booking['dropoff_address'] ?? booking['drop_address'] ?? booking['to_city'] ?? '',
      ),
    );
    if (confirm != true) return;

    setState(() => _actionLoading = true);
    try {
      final token = await AuthService.getToken();
      final res = await http.post(
        Uri.parse('${ApiConfig.baseUrl}/api/app/driver/outstation-pool/passengers/${booking['id']}/drop'),
        headers: {'Authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final earnings = (data['driverEarnings'] ?? fare).toString();
        _showSnack('$name dropped. Earnings: ₹$earnings', isSuccess: true);
        _loadPassengers();
      } else {
        _showSnack(jsonDecode(res.body)['message'] ?? 'Failed', isSuccess: false);
      }
    } catch (e) {
      _showSnack('Error: $e', isSuccess: false);
    } finally {
      setState(() => _actionLoading = false);
    }
  }

  Future<void> _sharePassenger(Map<String, dynamic> booking) async {
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.poolShare),
        headers: headers,
        body: jsonEncode({'module': 'outstation_pool', 'referenceId': booking['id']?.toString()}),
      ).timeout(const Duration(seconds: 12));
      final body = jsonDecode(res.body);
      if (res.statusCode == 200) {
        await Clipboard.setData(ClipboardData(text: body['shareText']?.toString() ?? 'JAGO Pool trip'));
        _showSnack('Passenger trip summary copied', isSuccess: true);
      } else {
        _showSnack(body['message']?.toString() ?? 'Could not prepare share summary', isSuccess: false);
      }
    } catch (_) {
      _showSnack('Could not prepare share summary', isSuccess: false);
    }
  }

  void _openPassengerChat(Map<String, dynamic> booking) {
    final bookingId = booking['id']?.toString() ?? '';
    if (bookingId.isEmpty) return;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => TripChatSheet(
        tripId: bookingId,
        senderName: 'Driver',
        chatScope: 'pool',
        poolModule: 'outstation_pool',
        title: 'Passenger Chat',
      ),
    );
  }

  void _startPassengerCall(Map<String, dynamic> booking) {
    final bookingId = booking['id']?.toString() ?? '';
    final customerId = booking['customer_id']?.toString() ?? '';
    if (bookingId.isEmpty || customerId.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => CallScreen(
          contactName: booking['passenger_name']?.toString() ?? 'Passenger',
          tripId: bookingId,
          targetUserId: customerId,
          callScope: 'pool',
          poolModule: 'outstation_pool',
        ),
      ),
    );
  }

  Future<void> _blockPassenger(Map<String, dynamic> booking) async {
    final blockedUserId = booking['customer_id']?.toString() ?? '';
    if (blockedUserId.isEmpty) return;
    try {
      final headers = await AuthService.getHeaders();
      headers['Content-Type'] = 'application/json';
      final res = await http.post(
        Uri.parse(ApiConfig.poolBlockUser),
        headers: headers,
        body: jsonEncode({
          'blockedUserId': blockedUserId,
          'module': 'outstation_pool',
          'referenceType': 'booking',
          'referenceId': booking['id']?.toString(),
          'reason': 'Blocked from outstation pool driver console',
        }),
      ).timeout(const Duration(seconds: 12));
      final body = jsonDecode(res.body);
      _showSnack(body['message']?.toString() ?? 'Passenger blocked from future pool matching', isSuccess: res.statusCode == 200);
    } catch (_) {
      _showSnack('Could not block passenger', isSuccess: false);
    }
  }

  Future<void> _sendPoolSos() async {
    final confirm = await _confirmDialog('Pool SOS', 'Send emergency alert for this outstation pool trip?', confirmLabel: 'Send SOS');
    if (!confirm) return;
    try {
      final headers = await AuthService.getHeaders();
      await http.post(
        Uri.parse(ApiConfig.sos),
        headers: {...headers, 'Content-Type': 'application/json'},
        body: jsonEncode({
          'tripId': _rideId,
          'lat': _ride['current_lat'],
          'lng': _ride['current_lng'],
          'message': 'Driver SOS alert during outstation pool trip',
        }),
      ).timeout(const Duration(seconds: 12));
      _showSnack('Pool SOS sent to JAGO safety operations', isSuccess: true);
    } catch (_) {
      _showSnack('SOS failed. Call emergency services immediately.', isSuccess: false);
    }
  }

  void _showSnack(String msg, {required bool isSuccess}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg,
        style: GoogleFonts.poppins(fontSize: 13, color: Colors.white, fontWeight: FontWeight.w500)),
      backgroundColor: isSuccess ? _green : _red,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      margin: const EdgeInsets.all(16),
    ));
  }

  Future<bool> _confirmDialog(String title, String body,
      {String confirmLabel = 'Confirm'}) async {
    return await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Text(title,
          style: GoogleFonts.poppins(fontWeight: FontWeight.w700, fontSize: 16, color: _textPri)),
        content: Text(body,
          style: GoogleFonts.poppins(fontSize: 14, color: _textSec)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('Cancel', style: GoogleFonts.poppins(color: _textSec)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: _primary,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(confirmLabel,
              style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    ) ?? false;
  }

  double? _readDouble(dynamic value) {
    if (value == null) return null;
    final parsed = double.tryParse(value.toString());
    if (parsed == null || parsed == 0) return null;
    return parsed;
  }

  Widget _buildTripMapHero() {
    final currentLat = _readDouble(_ride['current_lat']);
    final currentLng = _readDouble(_ride['current_lng']);
    final points = <LatLng>[];
    final markers = <Marker>{};

    if (currentLat != null && currentLng != null) {
      final driver = LatLng(currentLat, currentLng);
      points.add(driver);
      markers.add(
        Marker(
          markerId: const MarkerId('driver'),
          position: driver,
          infoWindow: const InfoWindow(title: 'Driver'),
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueAzure,
          ),
        ),
      );
    }

    for (var i = 0; i < _passengers.length; i++) {
      final p = _passengers[i] as Map<String, dynamic>;
      final pickupLat = _readDouble(p['pickup_lat'] ?? p['pickupLat']);
      final pickupLng = _readDouble(p['pickup_lng'] ?? p['pickupLng']);
      final dropLat = _readDouble(
        p['drop_lat'] ?? p['dropLat'] ?? p['dropoff_lat'] ?? p['dropoffLat'],
      );
      final dropLng = _readDouble(
        p['drop_lng'] ?? p['dropLng'] ?? p['dropoff_lng'] ?? p['dropoffLng'],
      );

      if (pickupLat != null && pickupLng != null) {
        final pickup = LatLng(pickupLat, pickupLng);
        points.add(pickup);
        markers.add(
          Marker(
            markerId: MarkerId('pickup_$i'),
            position: pickup,
            infoWindow: InfoWindow(
              title: 'Pickup ${i + 1}',
              snippet: p['passenger_name']?.toString() ?? 'Passenger',
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
              snippet: p['passenger_name']?.toString() ?? 'Passenger',
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
              polylineId: const PolylineId('outstation_route'),
              points: points,
              color: _primary,
              width: 5,
              startCap: Cap.roundCap,
              endCap: Cap.roundCap,
            ),
          }
        : <Polyline>{};

    return ClipRRect(
      borderRadius: BorderRadius.circular(24),
      child: Stack(
        children: [
          SizedBox(
            height: 320,
            child: GoogleMap(
              initialCameraPosition: CameraPosition(target: center, zoom: 11.8),
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
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(18),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Intercity route live',
                          style: GoogleFonts.poppins(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: _textPri,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Shared stops, seat occupancy, and route progress stay visible here.',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            color: _textSec,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: _primary.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(
                      '${_passengers.length} pax',
                      style: GoogleFonts.poppins(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w600,
                        color: _primary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStopSequenceCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Passenger Sequence',
            style: GoogleFonts.poppins(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: _textPri,
            ),
          ),
          const SizedBox(height: 12),
          if (_passengers.isEmpty)
            Text(
              'Confirmed passengers will appear here with pickup and drop order.',
              style: GoogleFonts.poppins(fontSize: 12, color: _textSec),
            ),
          ...List.generate(_passengers.length, (index) {
            final p = _passengers[index] as Map<String, dynamic>;
            final status = p['status']?.toString() ?? 'confirmed';
            return Padding(
              padding: EdgeInsets.only(bottom: index == _passengers.length - 1 ? 0 : 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: _primary.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Center(
                      child: Text(
                        '${index + 1}',
                        style: GoogleFonts.poppins(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: _primary,
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
                          p['passenger_name']?.toString() ?? 'Passenger',
                          style: GoogleFonts.poppins(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: _textPri,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Pickup: ${p['pickup_address'] ?? '-'}',
                          style: GoogleFonts.poppins(fontSize: 11.5, color: _textSec),
                        ),
                        Text(
                          'Drop: ${p['dropoff_address'] ?? p['drop_address'] ?? p['to_city'] ?? '-'}',
                          style: GoogleFonts.poppins(fontSize: 11.5, color: _textSec),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: status == 'picked_up'
                          ? _green.withValues(alpha: 0.10)
                          : _amber.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      status == 'picked_up' ? 'Onboard' : 'Boarding',
                      style: GoogleFonts.poppins(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: status == 'picked_up' ? _green : _amber,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: AppBar(
        backgroundColor: _bg,
        elevation: 0,
        surfaceTintColor: Colors.transparent,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20, color: _textPri),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${_ride['from_city'] ?? ''} → ${_ride['to_city'] ?? ''}',
              style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w700, color: _textPri)),
            Text(_isActive ? 'Trip in progress' : _isScheduled ? 'Scheduled' : (_ride['status'] ?? '').toString(),
              style: GoogleFonts.poppins(fontSize: 11, color: _isActive ? _green : _textSec)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _primary, size: 22),
            onPressed: _loadPassengers,
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: _loading
          ? _buildLoadingState()
          : RefreshIndicator(
              color: _primary,
              onRefresh: _loadPassengers,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final sheetMaxHeight =
                      constraints.maxHeight > 820 ? 390.0 : 360.0;
                  return Stack(
                    children: [
                      Positioned.fill(
                        child: ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: [
                            SizedBox(
                              height: constraints.maxHeight,
                              child: _buildTripMapHero(),
                            ),
                          ],
                        ),
                      ),
                      Align(
                        alignment: Alignment.bottomCenter,
                        child: Container(
                          constraints: BoxConstraints(maxHeight: sheetMaxHeight),
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
                                _buildRideInfo(),
                                const SizedBox(height: 12),
                                _buildStopSequenceCard(),
                                const SizedBox(height: 12),
                                _PrimaryButton(
                                  label: 'Pool SOS',
                                  icon: Icons.sos_rounded,
                                  onTap: _sendPoolSos,
                                ),
                                if (_isScheduled) ...[
                                  const SizedBox(height: 12),
                                  _PrimaryButton(
                                    label: _actionLoading ? 'Starting...' : 'Start Trip',
                                    icon: Icons.play_arrow_rounded,
                                    onTap: _actionLoading ? null : _startTrip,
                                    loading: _actionLoading,
                                  ),
                                ],
                                const SizedBox(height: 12),
                                if (_passengers.isEmpty)
                                  _buildEmpty()
                                else
                                  ...List.generate(
                                    _passengers.length,
                                    (i) => _PassengerCard(
                                      booking: _passengers[i],
                                      rideActive: _isActive,
                                      actionLoading: _actionLoading,
                                      onPickup: () => _pickupPassenger(
                                        _passengers[i]['id']?.toString() ?? '',
                                        _passengers[i]['passenger_name'] ?? 'Passenger',
                                      ),
                                      onDrop: () => _dropPassenger(_passengers[i]),
                                      onChat: () => _openPassengerChat(_passengers[i]),
                                      onCall: () => _startPassengerCall(_passengers[i]),
                                      onShare: () => _sharePassenger(_passengers[i]),
                                      onBlock: () => _blockPassenger(_passengers[i]),
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

  Widget _buildRideInfo() {
    final routeKm   = (_ride['route_km'] ?? 0.0) as num;
    final pkmps     = (_ride['price_per_km_per_seat'] ?? 1.8) as num;
    final avail     = _ride['available_seats'] ?? 0;
    final total     = _ride['total_seats'] ?? 4;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _border),
      ),
      child: Row(
        children: [
          _InfoPill(label: '${routeKm.toStringAsFixed(0)} km', icon: Icons.map_rounded, color: _primary),
          const SizedBox(width: 10),
          _InfoPill(label: '₹${pkmps.toStringAsFixed(1)}/km/seat', icon: Icons.currency_rupee_rounded, color: _green),
          const SizedBox(width: 10),
          _InfoPill(label: '${total - avail}/$total booked', icon: Icons.event_seat_rounded, color: _amber),
          if (_isActive) ...[
            const Spacer(),
            Row(children: [
              Container(width: 8, height: 8,
                decoration: const BoxDecoration(color: _green, shape: BoxShape.circle)),
              const SizedBox(width: 4),
              Text('Live', style: GoogleFonts.poppins(fontSize: 11, color: _green, fontWeight: FontWeight.w600)),
            ]),
          ],
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.people_outline_rounded, size: 52, color: Color(0xFFE5E9F0)),
          const SizedBox(height: 12),
          Text('No passengers yet.\nBookings will appear here.',
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(color: _textSec, fontSize: 14)),
        ],
      ),
    );
  }
}

// ── Passenger card ────────────────────────────────────────────────────────────

class _PassengerCard extends StatelessWidget {
  final Map<String, dynamic> booking;
  final bool rideActive;
  final bool actionLoading;
  final VoidCallback onPickup;
  final VoidCallback onDrop;
  final VoidCallback onChat;
  final VoidCallback onCall;
  final VoidCallback onShare;
  final VoidCallback onBlock;
  const _PassengerCard({
    required this.booking,
    required this.rideActive,
    required this.actionLoading,
    required this.onPickup,
    required this.onDrop,
    required this.onChat,
    required this.onCall,
    required this.onShare,
    required this.onBlock,
  });

  static const _primary  = Color(0xFF2D8CFF);
  static const _card     = Color(0xFFFFFFFF);
  static const _amber    = Color(0xFFF59E0B);
  static const _green    = Color(0xFF16A34A);
  static const _red      = Color(0xFFDC2626);
  static const _textPri  = Color(0xFF111827);
  static const _textSec  = Color(0xFF6B7280);

  String get _status => booking['status'] ?? '';
  Color get _statusColor {
    switch (_status) {
      case 'confirmed':  return _primary;
      case 'picked_up':  return _green;
      case 'dropped':    return _green;
      case 'cancelled':  return _red;
      default:           return _amber;
    }
  }
  String get _statusLabel {
    switch (_status) {
      case 'confirmed': return 'Waiting';
      case 'picked_up': return 'On board';
      case 'dropped':   return 'Dropped';
      case 'cancelled': return 'Cancelled';
      default:          return _status.toUpperCase();
    }
  }

  @override
  Widget build(BuildContext context) {
    final name      = booking['passenger_name'] ?? 'Passenger';
    final seats     = booking['seats_booked'] ?? 1;
    final farePerSeat = (booking['fare_per_seat'] ?? 0.0) as num;
    final totalFare = (booking['total_fare'] ?? 0.0) as num;
    final segKm     = (booking['segment_km'] ?? 0.0) as num;
    final pickup    = booking['pickup_address'] ?? '';
    final drop      = booking['dropoff_address'] ?? booking['drop_address'] ?? booking['to_city'] ?? '';
    final pMethod   = booking['payment_method'] ?? 'cash';
    final safety = booking['safety'] is Map<String, dynamic> ? booking['safety'] as Map<String, dynamic> : null;
    final safetyLabel = safety?['badgeLabel']?.toString();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _statusColor.withValues(alpha: 0.18)),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 2))],
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Name + status
            Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: _primary.withValues(alpha: 0.12),
                  child: Text(name.isNotEmpty ? name[0].toUpperCase() : 'P',
                    style: GoogleFonts.poppins(color: _primary, fontWeight: FontWeight.w700, fontSize: 16)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(name,
                            style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w600, color: _textPri)),
                        ),
                        if (safetyLabel != null) _userSafetyBadge(safetyLabel),
                      ],
                    ),
                    Text('$seats seat${seats > 1 ? 's' : ''}  ·  ${segKm.toStringAsFixed(0)} km',
                      style: GoogleFonts.poppins(fontSize: 12, color: _textSec)),
                  ]),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  decoration: BoxDecoration(
                    color: _statusColor.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: _statusColor.withValues(alpha: 0.25)),
                  ),
                  child: Text(_statusLabel,
                    style: GoogleFonts.poppins(
                      color: _statusColor, fontSize: 11, fontWeight: FontWeight.w600)),
                ),
              ],
            ),

            // Fare breakdown
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFFF3F7FF),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(children: [
                _FareRow('Fare/seat', '₹${farePerSeat.toStringAsFixed(0)}'),
                if (seats > 1)
                  _FareRow('× $seats seats', '= ₹${totalFare.toStringAsFixed(0)}',
                    isBold: true, color: _primary),
                if (seats == 1)
                  _FareRow('Total', '₹${totalFare.toStringAsFixed(0)}',
                    isBold: true, color: _primary),
                _FareRow('Payment', pMethod.toUpperCase(), color: _textSec),
              ]),
            ),

            // Pickup / drop addresses
            if (pickup.isNotEmpty || drop.isNotEmpty) ...[
              const SizedBox(height: 10),
              if (pickup.isNotEmpty) _AddressRow(Icons.circle_rounded, pickup, const Color(0xFF16A34A)),
              if (drop.isNotEmpty)   _AddressRow(Icons.location_on_rounded, drop, const Color(0xFFDC2626)),
            ],

            // Action buttons
            if (rideActive && (_status == 'confirmed' || _status == 'picked_up')) ...[
              const SizedBox(height: 12),
              Row(children: [
                if (_status == 'confirmed')
                  Expanded(
                    child: _ActionButton(
                      label: 'Picked Up',
                      icon: Icons.person_add_rounded,
                      color: _green,
                      loading: actionLoading,
                      onTap: onPickup,
                    ),
                  ),
                if (_status == 'picked_up') ...[
                  Expanded(
                    child: _ActionButton(
                      label: 'Drop  ₹${totalFare.toStringAsFixed(0)}',
                      icon: Icons.person_remove_rounded,
                      color: _primary,
                      loading: actionLoading,
                      onTap: onDrop,
                    ),
                  ),
                ],
              ]),
            ],
            if (_status == 'dropped') ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: _ActionButton(
                  label: 'Rate Passenger',
                  icon: Icons.star_rounded,
                  color: _amber,
                  loading: false,
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => PassengerRatingScreen(
                        bookingId: booking['id']?.toString() ?? '',
                        passengerName: name.toString(),
                        isOutstation: true,
                      ),
                    ),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                OutlinedButton.icon(
                  onPressed: onChat,
                  style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                  icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16),
                  label: Text('Chat', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12)),
                ),
                OutlinedButton.icon(
                  onPressed: onCall,
                  style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                  icon: const Icon(Icons.call_rounded, size: 16),
                  label: Text('Call', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12)),
                ),
                OutlinedButton.icon(
                  onPressed: onShare,
                  style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                  icon: const Icon(Icons.share_outlined, size: 16),
                  label: Text('Share', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12)),
                ),
                OutlinedButton.icon(
                  onPressed: onBlock,
                  style: OutlinedButton.styleFrom(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
                  icon: const Icon(Icons.block_outlined, size: 16),
                  label: Text('Block', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

Widget _userSafetyBadge(String label) {
  const primary = Color(0xFF2D8CFF);
  final color = label == 'Blocked User'
      ? JT.error
      : label == 'High Risk User'
          ? JT.warning
          : primary;
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

// ── Drop confirm bottom sheet ─────────────────────────────────────────────────

class _DropConfirmSheet extends StatelessWidget {
  final String passengerName;
  final int seats;
  final double farePerSeat;
  final double totalFare;
  final double segmentKm;
  final String dropAddress;

  const _DropConfirmSheet({
    required this.passengerName,
    required this.seats,
    required this.farePerSeat,
    required this.totalFare,
    required this.segmentKm,
    required this.dropAddress,
  });

  static const _primary  = Color(0xFF2D8CFF);
  static const _green    = Color(0xFF16A34A);
  static const _textPri  = Color(0xFF111827);
  static const _textSec  = Color(0xFF6B7280);
  static const _border   = Color(0xFFE5E9F0);

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(width: 36, height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFE5E9F0),
                borderRadius: BorderRadius.circular(4))),
          ),
          const SizedBox(height: 18),
          Text('Drop $passengerName',
            style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700, color: _textPri)),
          const SizedBox(height: 4),
          Text(dropAddress.isNotEmpty ? dropAddress : 'Destination',
            style: GoogleFonts.poppins(fontSize: 13, color: _textSec)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFFF3F7FF),
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: _border),
            ),
            child: Column(children: [
              _FareRow('Segment distance', '${segmentKm.toStringAsFixed(1)} km'),
              _FareRow('Fare per seat', '₹${farePerSeat.toStringAsFixed(0)}'),
              if (seats > 1)
                _FareRow('× $seats seats', '', isBold: false),
              Divider(color: _border, height: 20),
              _FareRow('Total fare', '₹${totalFare.toStringAsFixed(0)}',
                isBold: true, color: _primary),
            ]),
          ),
          const SizedBox(height: 8),
          Text('Commission (15%) + GST + insurance will be deducted from your earnings.',
            style: GoogleFonts.poppins(fontSize: 11, color: _textSec)),
          const SizedBox(height: 20),
          Row(children: [
            Expanded(
              child: GestureDetector(
                onTap: () => Navigator.pop(context, false),
                child: Container(
                  height: 50,
                  decoration: BoxDecoration(
                    border: Border.all(color: _border),
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Center(
                    child: Text('Cancel',
                      style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: _textSec))),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: GestureDetector(
                onTap: () => Navigator.pop(context, true),
                child: Container(
                  height: 50,
                  decoration: BoxDecoration(
                    color: _green,
                    borderRadius: BorderRadius.circular(14),
                    boxShadow: [BoxShadow(
                      color: _green.withValues(alpha: 0.25), blurRadius: 10, offset: const Offset(0, 4))],
                  ),
                  child: Center(
                    child: Text('Confirm Drop  ₹${totalFare.toStringAsFixed(0)}',
                      style: GoogleFonts.poppins(
                        color: Colors.white, fontWeight: FontWeight.w700, fontSize: 14))),
                ),
              ),
            ),
          ]),
        ],
      ),
    );
  }
}

class PassengerRatingScreen extends StatefulWidget {
  final String bookingId;
  final String passengerName;
  final bool isOutstation;

  const PassengerRatingScreen({
    super.key,
    required this.bookingId,
    required this.passengerName,
    required this.isOutstation,
  });

  @override
  State<PassengerRatingScreen> createState() => _PassengerRatingScreenState();
}

class _PassengerRatingScreenState extends State<PassengerRatingScreen> {
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
        Uri.parse(widget.isOutstation
            ? ApiConfig.outstationPoolRatePassenger(widget.bookingId)
            : ApiConfig.localPoolRatePassenger(widget.bookingId)),
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
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Passenger rating submitted')),
        );
        Navigator.pop(context, body);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(body['message']?.toString() ?? 'Could not submit rating')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Network issue while submitting rating')),
      );
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
                Text('Rate this passenger after trip completion. Only one rating is allowed per trip.', style: JT.body),
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
                    hintText: 'Add optional notes for this passenger',
                    filled: true,
                    fillColor: JT.surfaceAlt,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: JT.border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide(color: JT.border),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          JT.gradientButton(
            label: _loading ? 'Submitting...' : 'Submit Rating',
            onTap: _submit,
            loading: _loading,
          ),
        ],
      ),
    );
  }
}

// ── Small shared widgets ──────────────────────────────────────────────────────

class _FareRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isBold;
  final Color? color;
  const _FareRow(this.label, this.value, {this.isBold = false, this.color});

  @override
  Widget build(BuildContext context) {
    final c = color ?? const Color(0xFF111827);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label,
            style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280))),
          Text(value,
            style: GoogleFonts.poppins(
              fontSize: 12,
              fontWeight: isBold ? FontWeight.w700 : FontWeight.w500,
              color: c,
            )),
        ],
      ),
    );
  }
}

class _AddressRow extends StatelessWidget {
  final IconData icon;
  final String address;
  final Color iconColor;
  const _AddressRow(this.icon, this.address, this.iconColor);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        children: [
          Icon(icon, size: 12, color: iconColor),
          const SizedBox(width: 6),
          Expanded(
            child: Text(address, maxLines: 1, overflow: TextOverflow.ellipsis,
              style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280))),
          ),
        ],
      ),
    );
  }
}

class _InfoPill extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  const _InfoPill({required this.label, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Icon(icon, size: 13, color: color),
      const SizedBox(width: 4),
      Text(label, style: GoogleFonts.poppins(fontSize: 11, color: color, fontWeight: FontWeight.w600)),
    ]);
  }
}

class _PrimaryButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final VoidCallback? onTap;
  final bool loading;
  const _PrimaryButton({
    required this.label, required this.icon,
    required this.onTap, this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 56,
        decoration: BoxDecoration(
          color: const Color(0xFF2D8CFF),
          borderRadius: BorderRadius.circular(14),
          boxShadow: [BoxShadow(
            color: const Color(0xFF2D8CFF).withValues(alpha: 0.25),
            blurRadius: 12, offset: const Offset(0, 4))],
        ),
        child: Center(
          child: loading
              ? const SizedBox(width: 22, height: 22,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
              : Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(icon, color: Colors.white, size: 20),
                  const SizedBox(width: 8),
                  Text(label,
                    style: GoogleFonts.poppins(
                      color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
                ]),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final bool loading;
  final VoidCallback? onTap;
  const _ActionButton({
    required this.label, required this.icon,
    required this.color, required this.loading, required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: loading ? null : onTap,
      child: Container(
        height: 44,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(12),
          boxShadow: [BoxShadow(
            color: color.withValues(alpha: 0.22), blurRadius: 8, offset: const Offset(0, 3))],
        ),
        child: Center(
          child: loading
              ? const SizedBox(width: 18, height: 18,
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
              : Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(icon, color: Colors.white, size: 17),
                  const SizedBox(width: 6),
                  Text(label,
                    style: GoogleFonts.poppins(
                      color: Colors.white, fontWeight: FontWeight.w700, fontSize: 13)),
                ]),
        ),
      ),
    );
  }
}
