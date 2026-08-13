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
import '../../services/socket_service.dart';
import '../call/call_screen.dart';
import '../chat/trip_chat_sheet.dart';

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
            child: CircularProgressIndicator(
              color: _primary,
              strokeWidth: 2.5,
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'Preparing your pool dashboard...',
            style: GoogleFonts.poppins(fontSize: 13, color: _textSec),
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
  Map<String, dynamic>? _session;
  List<dynamic> _passengers = [];
  Map<String, dynamic>? _seatState;
  String? _error;

  static const _primary = Color(0xFF2D8CFF);
  static const _bg = Color(0xFFFFFFFF);
  static const _surface = Color(0xFFF8FAFE);
  static const _border = Color(0xFFE5E9F0);
  static const _textPri = Color(0xFF111827);
  static const _textSec = Color(0xFF6B7280);

  @override
  void initState() {
    super.initState();
    _wireSocket();
    _load();
    _poller = Timer.periodic(const Duration(seconds: 8), (_) => _load(silent: true));
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
    _newPassengerSub = _socket.onPoolNewPassenger.listen((_) => _load(silent: true));
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(body['message']?.toString() ?? 'Could not start local pool')),
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
                          'Shared route live',
                          style: GoogleFonts.poppins(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: _textPri,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Pickup order, drop order, and seat queue are visible here.',
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
                      '${_passengers.length} riders',
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

  Widget _buildSequenceCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Pickup & Drop Order',
            style: GoogleFonts.poppins(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: _textPri,
            ),
          ),
          const SizedBox(height: 12),
          if (_passengers.isEmpty)
            Text(
              'Passenger queue will appear here once pooling starts.',
              style: GoogleFonts.poppins(fontSize: 12, color: _textSec),
            ),
          ...List.generate(_passengers.length, (index) {
            final p = _passengers[index] as Map<String, dynamic>;
            final status = p['status']?.toString() ?? 'matched';
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
                          p['customer_name']?.toString() ?? 'Passenger',
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
                          'Drop: ${p['drop_address'] ?? '-'}',
                          style: GoogleFonts.poppins(fontSize: 11.5, color: _textSec),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: status == 'picked_up'
                          ? const Color(0xFF16A34A).withValues(alpha: 0.10)
                          : _primary.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      status == 'picked_up'
                          ? 'Onboard'
                          : status == 'pending_driver_accept'
                              ? 'Awaiting accept'
                              : 'Boarding OTP',
                      style: GoogleFonts.poppins(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: status == 'picked_up'
                            ? const Color(0xFF16A34A)
                            : _primary,
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
        title: Text('Local Pool', style: GoogleFonts.poppins(fontSize: 17, fontWeight: FontWeight.w600, color: _textPri)),
        actions: [
          IconButton(icon: const Icon(Icons.refresh_rounded, color: _primary), onPressed: _load),
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
                      color: _primary,
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
                        children: [_buildStarter()],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _load,
                      color: _primary,
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          final sheetMaxHeight =
                              constraints.maxHeight > 820 ? 380.0 : 350.0;
                          return Stack(
                            children: [
                              Positioned.fill(
                                child: ListView(
                                  physics: const AlwaysScrollableScrollPhysics(),
                                  children: [
                                    SizedBox(
                                      height: constraints.maxHeight,
                                      child: _buildPoolMapHero(),
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
                                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
                                    child: Column(
                                      children: [
                                        _buildSheetHandle(),
                                        const SizedBox(height: 12),
                                        _buildSessionHero(),
                                        const SizedBox(height: 14),
                                        _buildAcceptingControl(),
                                        const SizedBox(height: 14),
                                        _buildMetrics(),
                                        const SizedBox(height: 14),
                                        _buildSequenceCard(),
                                        const SizedBox(height: 14),
                                        _buildSeatDeck(),
                                        const SizedBox(height: 14),
                                        _buildSafetyActions(),
                                        const SizedBox(height: 14),
                                        _buildPassengers(),
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

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_rounded, size: 52, color: _textSec),
          const SizedBox(height: 12),
          Text(_error!, style: GoogleFonts.poppins(color: _textSec)),
        ],
      ),
    );
  }

  Widget _buildStarter() {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Start Local Pool Mode', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 18, color: _textPri)),
          const SizedBox(height: 8),
          Text('Go live for shared city rides. Passengers will be clustered by direction and live seat availability.', style: GoogleFonts.poppins(fontSize: 13, color: _textSec)),
          const SizedBox(height: 18),
          Text('Seats', style: GoogleFonts.poppins(fontWeight: FontWeight.w500)),
          const SizedBox(height: 8),
          DropdownButtonFormField<int>(
            initialValue: _maxSeats,
            decoration: InputDecoration(
              filled: true,
              fillColor: _surface,
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
            ),
            items: const [3, 4, 5, 6].map((e) => DropdownMenuItem(value: e, child: Text('$e seats'))).toList(),
            onChanged: (v) => setState(() => _maxSeats = v ?? 4),
          ),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton(
              onPressed: _starting ? null : _startSession,
              style: ElevatedButton.styleFrom(
                backgroundColor: _primary,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              ),
              child: Text(_starting ? 'Starting...' : 'Start Local Pool', style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSessionHero() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF2D8CFF), Color(0xFF1E6BE6)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: _primary.withValues(alpha: 0.25), blurRadius: 18, offset: const Offset(0, 8))],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Pool mode active', style: GoogleFonts.poppins(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w600)),
                const SizedBox(height: 6),
                Text('Live seat sync, OTP boarding, and grouped passenger queue are active now.', style: GoogleFonts.poppins(color: Colors.white.withValues(alpha: 0.92), fontSize: 12.5)),
              ],
            ),
          ),
          TextButton(
            onPressed: _ending ? null : _endSession,
            style: TextButton.styleFrom(
              backgroundColor: Colors.white.withValues(alpha: 0.16),
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
            child: Text(_ending ? 'Ending...' : 'End', style: GoogleFonts.poppins(fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
  }

  Widget _buildMetrics() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: _border)),
      child: Row(
        children: [
          Expanded(child: _metric('Available', '${_seatState?['availableSeats'] ?? _session?['available_seats'] ?? 0}')),
          Expanded(child: _metric('Occupied', '${_seatState?['occupiedSeats'] ?? 0}')),
          Expanded(child: _metric('Onboard', '${_seatState?['onboardPassengers'] ?? 0}')),
        ],
      ),
    );
  }

  Widget _buildSafetyActions() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Pool Safety & Share', style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w600, color: _textPri)),
          const SizedBox(height: 6),
          Text('Use live safety operations, share pool details, and enforce passenger blocking from one place.', style: GoogleFonts.poppins(fontSize: 12, color: _textSec)),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _actionPill(Icons.sos_rounded, 'Pool SOS', _sendPoolSos, const Color(0xFFDC2626)),
              if (_passengers.isNotEmpty)
                _actionPill(Icons.share_outlined, 'Share First Rider', () => _sharePassenger(_passengers.first as Map<String, dynamic>), _primary),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSeatDeck() {
    final maxSeats =
        int.tryParse('${_seatState?['maxSeats'] ?? _session?['max_seats'] ?? _maxSeats}') ?? _maxSeats;
    final available =
        int.tryParse('${_seatState?['availableSeats'] ?? _session?['available_seats'] ?? maxSeats}') ??
            maxSeats;
    final occupied = (maxSeats - available).clamp(0, maxSeats);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Seat Occupancy Map',
            style: GoogleFonts.poppins(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: _textPri,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Driver seat plus live passenger capacity for this rolling pool session.',
            style: GoogleFonts.poppins(fontSize: 12, color: _textSec),
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              _seatTile('D', 'Driver', _primary),
              ...List.generate(maxSeats, (index) {
                final isOccupied = index < occupied;
                return _seatTile(
                  'S${index + 1}',
                  isOccupied ? 'Occupied' : 'Open',
                  isOccupied ? const Color(0xFFF59E0B) : const Color(0xFF16A34A),
                );
              }),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _acceptPassenger(String requestId) async {
    await _postSimple(ApiConfig.localPoolAcceptPassenger(requestId), const {});
  }

  Future<void> _skipPassenger(String requestId) async {
    await _postSimple(ApiConfig.localPoolSkipPassenger(requestId), const {});
  }

  Widget _buildAcceptingControl() {
    final accepting = _acceptingNewPassengers;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: _border)),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: (accepting ? const Color(0xFF16A34A) : const Color(0xFFF97316)).withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(
              accepting ? Icons.group_add_rounded : Icons.pause_circle_filled_rounded,
              color: accepting ? const Color(0xFF16A34A) : const Color(0xFFF97316),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(accepting ? 'Accepting new passengers' : 'New passengers paused', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: _textPri)),
                const SizedBox(height: 2),
                Text(
                  accepting ? 'Matching is live while seats are available.' : 'Current passengers continue. No new pool requests will match.',
                  style: GoogleFonts.poppins(fontSize: 12, color: _textSec),
                ),
              ],
            ),
          ),
          Switch.adaptive(
            value: accepting,
            activeThumbColor: _primary,
            onChanged: _updatingAccepting ? null : _toggleAccepting,
          ),
        ],
      ),
    );
  }

  Widget _metric(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: GoogleFonts.poppins(fontSize: 12, color: _textSec)),
        const SizedBox(height: 4),
        Text(value, style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w600, color: _textPri)),
      ],
    );
  }

  Widget _seatTile(String label, String subtitle, Color color) {
    return Container(
      width: 78,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Column(
        children: [
          Icon(Icons.event_seat_rounded, size: 18, color: color),
          const SizedBox(height: 6),
          Text(
            label,
            style: GoogleFonts.poppins(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: _textPri,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            subtitle,
            style: GoogleFonts.poppins(
              fontSize: 10.5,
              color: _textSec,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPassengers() {
    if (_passengers.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(26),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: _border)),
        child: Column(
          children: [
            const Icon(Icons.people_outline_rounded, color: _textSec, size: 46),
            const SizedBox(height: 10),
            Text('Waiting for pooled passengers', style: GoogleFonts.poppins(fontSize: 14, color: _textSec)),
          ],
        ),
      );
    }
    return Column(
      children: _passengers.map((p) => _buildPassengerCard(p as Map<String, dynamic>)).toList(),
    );
  }

  Widget _buildPassengerCard(Map<String, dynamic> p) {
    final status = p['status']?.toString() ?? 'matched';
    final requestId = p['id']?.toString() ?? '';
    final safety = p['safety'] is Map<String, dynamic> ? p['safety'] as Map<String, dynamic> : null;
    final safetyLabel = safety?['badgeLabel']?.toString();
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: _border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: _primary.withValues(alpha: 0.1),
                child: Text(
                  (p['customer_name']?.toString().isNotEmpty == true) ? p['customer_name'].toString()[0].toUpperCase() : 'P',
                  style: GoogleFonts.poppins(color: _primary, fontWeight: FontWeight.w700),
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
                          child: Text(p['customer_name']?.toString() ?? 'Passenger', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, color: _textPri)),
                        ),
                        if (safetyLabel != null) _userSafetyBadge(safetyLabel),
                      ],
                    ),
                    const SizedBox(height: 2),
                    Text('${p['seats_requested'] ?? 1} seat(s) · ₹${double.tryParse('${p['total_fare'] ?? 0}')?.toStringAsFixed(0) ?? '0'}', style: GoogleFonts.poppins(fontSize: 12, color: _textSec)),
                  ],
                ),
              ),
              _statusBadge(status),
            ],
          ),
          const SizedBox(height: 12),
          Text('Pickup: ${p['pickup_address'] ?? '-'}', style: GoogleFonts.poppins(fontSize: 12, color: _textSec)),
          const SizedBox(height: 4),
          Text('Drop: ${p['drop_address'] ?? '-'}', style: GoogleFonts.poppins(fontSize: 12, color: _textSec)),
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
                    style: ElevatedButton.styleFrom(backgroundColor: _primary, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
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
        color = _primary;
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

Widget _actionPill(IconData icon, String label, Future<void> Function() onTap, Color color) {
  return InkWell(
    onTap: onTap,
    borderRadius: BorderRadius.circular(14),
    child: Ink(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: color.withValues(alpha: 0.20)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 8),
          Text(label, style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w600, color: color)),
        ],
      ),
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
