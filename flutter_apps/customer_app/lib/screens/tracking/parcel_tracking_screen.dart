import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import '../../core/map_night_style.dart';
import '../../services/error_reporting.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../services/socket_service.dart';
import '../../services/trip_service.dart';
import '../main_screen.dart';

class ParcelTrackingScreen extends StatefulWidget {
  final String orderId;
  const ParcelTrackingScreen({super.key, required this.orderId});

  @override
  State<ParcelTrackingScreen> createState() => _ParcelTrackingScreenState();
}

class _ParcelTrackingScreenState extends State<ParcelTrackingScreen>
    with WidgetsBindingObserver {
  Timer? _pollTimer;
  final SocketService _socket = SocketService();
  final List<StreamSubscription> _subs = [];
  GoogleMapController? _mapController;
  bool _loading = true;
  bool _cancelLoading = false;
  String? _error;
  Map<String, dynamic>? _order;
  final Set<Marker> _markers = {};
  final Set<Polyline> _polylines = {};
  LatLng _center = const LatLng(17.3850, 78.4867);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _fetchOrder();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) => _fetchOrder());
    _subs.add(_socket.onParcelStatus.listen((data) {
      if (!mounted) return;
      if ((data['orderId']?.toString() ?? '') != widget.orderId) return;
      _fetchOrder();
    }));
    _subs.add(_socket.onParcelLocation.listen((data) {
      if (!mounted) return;
      if ((data['orderId']?.toString() ?? '') != widget.orderId) return;
      _fetchOrder();
    }));
    _socket.connect(ApiConfig.socketUrl).then((_) {
      _socket.trackParcel(widget.orderId);
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _fetchOrder();
      _socket.connect(ApiConfig.socketUrl).then((_) {
        _socket.trackParcel(widget.orderId);
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _pollTimer?.cancel();
    for (final sub in _subs) {
      sub.cancel();
    }
    _socket.stopTrackingParcel(widget.orderId);
    super.dispose();
  }

  String get _status => _order?['currentStatus']?.toString() ?? 'searching';

  bool get _canCancel => _status == 'pending' || _status == 'searching';

  double? _readDouble(dynamic value) {
    if (value == null) return null;
    final parsed = double.tryParse(value.toString());
    if (parsed == null || parsed == 0) return null;
    return parsed;
  }

  List<LatLng> _decodePolyline(String encoded) {
    final List<LatLng> pts = [];
    int index = 0;
    int lat = 0;
    int lng = 0;
    while (index < encoded.length) {
      int b;
      int shift = 0;
      int result = 0;
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

  Future<void> _fetchOrder() async {
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .get(Uri.parse(ApiConfig.parcelTrack(widget.orderId)), headers: headers)
          .timeout(const Duration(seconds: 10));
      if (!mounted) return;
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final order = data['order'];
        setState(() {
          _order = order is Map<String, dynamic> ? order : null;
          _loading = false;
          _error = null;
        });
        unawaited(_syncMapDecorations());
        if (_status == 'completed' || _status == 'cancelled') {
          _pollTimer?.cancel();
        }
      } else {
        setState(() {
          _loading = false;
          _error = 'Could not load parcel status.';
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Network error while loading parcel status.';
      });
    }
  }

  Future<void> _cancelOrder() async {
    if (_cancelLoading) return;
    HapticFeedback.selectionClick();
    setState(() => _cancelLoading = true);
    final result = await TripService.cancelParcelOrder(
      widget.orderId,
      reason: 'Customer cancelled to continue with a new booking',
    );
    if (!mounted) return;
    setState(() => _cancelLoading = false);
    if (result['success'] == true) {
      await _fetchOrder();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Parcel order cancelled successfully')),
      );
      return;
    }
    final message = result['message']?.toString() ??
        result['error']?.toString() ??
        'Could not cancel parcel order.';
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Future<void> _syncMapDecorations() async {
    final order = _order;
    if (order == null) return;

    final pickupLat =
        _readDouble(order['pickupLat'] ?? order['pickup_lat']) ?? _center.latitude;
    final pickupLng =
        _readDouble(order['pickupLng'] ?? order['pickup_lng']) ?? _center.longitude;
    final drops = (order['drops'] as List<dynamic>? ?? const []).cast<dynamic>();
    final firstDrop = drops.isNotEmpty ? drops.first : null;
    final dropLat = _readDouble(
      order['destinationLat'] ??
          order['destination_lat'] ??
          (firstDrop is Map<String, dynamic>
              ? firstDrop['lat'] ?? firstDrop['dropLat'] ?? firstDrop['drop_lat']
              : null),
    );
    final dropLng = _readDouble(
      order['destinationLng'] ??
          order['destination_lng'] ??
          (firstDrop is Map<String, dynamic>
              ? firstDrop['lng'] ?? firstDrop['dropLng'] ?? firstDrop['drop_lng']
              : null),
    );
    final driverLat = _readDouble(
      order['driverLat'] ?? order['driver_lat'] ?? order['currentLat'],
    );
    final driverLng = _readDouble(
      order['driverLng'] ?? order['driver_lng'] ?? order['currentLng'],
    );

    _center = LatLng(driverLat ?? pickupLat, driverLng ?? pickupLng);

    final markers = <Marker>{
      Marker(
        markerId: const MarkerId('pickup'),
        position: LatLng(pickupLat, pickupLng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
        infoWindow: InfoWindow(
          title: 'Pickup',
          snippet: order['pickupAddress']?.toString() ?? 'Pickup',
        ),
      ),
    };

    if (dropLat != null && dropLng != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('drop'),
          position: LatLng(dropLat, dropLng),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
          infoWindow: InfoWindow(
            title: 'Drop',
            snippet: firstDrop is Map<String, dynamic>
                ? firstDrop['address']?.toString() ?? 'Drop'
                : 'Drop',
          ),
        ),
      );
    }

    if (driverLat != null && driverLng != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('driver'),
          position: LatLng(driverLat, driverLng),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
          infoWindow: const InfoWindow(title: 'Driver'),
          zIndex: 2,
        ),
      );
    }

    if (!mounted) return;
    setState(() {
      _markers
        ..clear()
        ..addAll(markers);
    });

    if (driverLat != null &&
        driverLng != null &&
        dropLat != null &&
        dropLng != null) {
      try {
        final headers = await AuthService.getHeaders();
        final res = await http
            .post(
              Uri.parse(ApiConfig.routeMultiWaypoint),
              headers: {...headers, 'Content-Type': 'application/json'},
              body: jsonEncode({
                'origin': {'lat': driverLat, 'lng': driverLng},
                'destination': {'lat': dropLat, 'lng': dropLng},
                'waypoints': const [],
                'optimize': false,
              }),
            )
            .timeout(const Duration(seconds: 8));
        if (!mounted || res.statusCode != 200) return;
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        final polyline = data['overviewPolyline']?.toString();
        if (polyline == null || polyline.isEmpty) return;
        setState(() {
          _polylines
            ..clear()
            ..add(
              Polyline(
                polylineId: const PolylineId('parcel_route'),
                points: _decodePolyline(polyline),
                color: JT.primary,
                width: 5,
                jointType: JointType.round,
                startCap: Cap.roundCap,
                endCap: Cap.roundCap,
              ),
            );
        });
      } catch (e, st) {
        reportSilentFailure('ParcelTrackingScreen._fetchRoute', e, st);
      }
    }

    _fitMap();
  }

  void _fitMap() {
    if (_mapController == null || _markers.isEmpty) return;
    final points = _markers.map((m) => m.position).toList();
    final south = points.map((p) => p.latitude).reduce(math.min);
    final north = points.map((p) => p.latitude).reduce(math.max);
    final west = points.map((p) => p.longitude).reduce(math.min);
    final east = points.map((p) => p.longitude).reduce(math.max);
    _mapController!.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(south, west),
          northeast: LatLng(north, east),
        ),
        72,
      ),
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

  Widget _buildLoadingState() {
    return const Center(
      child: SizedBox(
        width: 44,
        height: 44,
        child: CircularProgressIndicator(
          color: JT.primary,
          strokeWidth: 2.6,
        ),
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: JT.bgSoft,
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(
                Icons.location_off_rounded,
                color: JT.textSecondary,
                size: 30,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              _error ?? 'Unable to load parcel tracking.',
              textAlign: TextAlign.center,
              style: GoogleFonts.poppins(
                fontSize: 13,
                color: JT.textSecondary,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _fetchOrder,
              style: ElevatedButton.styleFrom(
                backgroundColor: JT.primary,
                foregroundColor: Colors.white,
                minimumSize: const Size.fromHeight(52),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: Text(
                'Retry Tracking',
                style: GoogleFonts.poppins(fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'completed':
        return JT.success;
      case 'cancelled':
        return const Color(0xFFDC2626);
      case 'driver_assigned':
      case 'accepted':
      case 'picked_up':
      case 'in_transit':
        return JT.primary;
      default:
        return const Color(0xFFF59E0B);
    }
  }

  String _statusLabel(String status) {
    switch (status) {
      case 'driver_assigned':
        return 'Driver assigned';
      case 'picked_up':
        return 'Parcel picked up';
      case 'in_transit':
        return 'Parcel in transit';
      case 'completed':
        return 'Parcel delivered';
      case 'cancelled':
        return 'Parcel cancelled';
      default:
        return status.replaceAll('_', ' ');
    }
  }

  Widget _infoCard({
    required IconData icon,
    required String title,
    required String value,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: JT.primaryDark, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.poppins(
                    fontSize: 12,
                    color: const Color(0xFF64748B),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  value,
                  style: GoogleFonts.poppins(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: const Color(0xFF0F172A),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _trackingActionButton({
    required IconData icon,
    required String label,
    required VoidCallback? onTap,
    bool danger = false,
  }) {
    return SizedBox(
      height: 56,
      child: ElevatedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 18),
        label: Text(label),
        style: ElevatedButton.styleFrom(
          backgroundColor: danger ? const Color(0xFFDC2626) : JT.primary,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
      ),
    );
  }

  Future<void> _launchPhone(String phone) async {
    final uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  @override
  Widget build(BuildContext context) {
    final order = _order;
    final drops = (order?['drops'] as List<dynamic>? ?? const []).cast<dynamic>();
    final driverName = order?['driverName']?.toString() ?? '';
    final driverPhone = order?['driverPhone']?.toString() ?? '';
    final eta =
        order?['etaMinutes']?.toString() ?? order?['eta']?.toString() ?? '--';
    final fare = order?['totalFare']?.toString() ??
        order?['total_fare']?.toString() ??
        '0';

    return Scaffold(
      backgroundColor: Colors.white,
      body: _loading
          ? _buildLoadingState()
          : _error != null
              ? _buildErrorState()
              : Stack(
                  children: [
                    Positioned.fill(
                      child: RefreshIndicator(
                        onRefresh: _fetchOrder,
                        child: ListView(
                          physics: const AlwaysScrollableScrollPhysics(),
                          children: [
                            SizedBox(
                              height: MediaQuery.of(context).size.height,
                              child: GoogleMap(
                                initialCameraPosition:
                                    CameraPosition(target: _center, zoom: 14),
                                style: Theme.of(context).brightness == Brightness.dark ? kMapNightStyle : null,
                                onMapCreated: (controller) {
                                  _mapController = controller;
                                  _syncMapDecorations();
                                },
                                markers: _markers,
                                polylines: _polylines,
                                myLocationEnabled: true,
                                myLocationButtonEnabled: false,
                                mapToolbarEnabled: false,
                                zoomControlsEnabled: false,
                                padding: const EdgeInsets.only(bottom: 260),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    SafeArea(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                        child: Row(
                          children: [
                            Material(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              child: IconButton(
                                onPressed: () => Navigator.maybePop(context),
                                icon: const Icon(
                                  Icons.arrow_back_ios_new_rounded,
                                  size: 18,
                                  color: Color(0xFF0F172A),
                                ),
                              ),
                            ),
                            const Spacer(),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 10,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(16),
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    'ETA $eta min',
                                    style: GoogleFonts.poppins(
                                      fontSize: 12,
                                      fontWeight: FontWeight.w600,
                                      color: const Color(0xFF0F172A),
                                    ),
                                  ),
                                  Text(
                                    'Order ${widget.orderId.substring(0, widget.orderId.length > 8 ? 8 : widget.orderId.length).toUpperCase()}',
                                    style: GoogleFonts.poppins(
                                      fontSize: 11,
                                      color: const Color(0xFF64748B),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    Align(
                      alignment: Alignment.bottomCenter,
                      child: Container(
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
                        child: SafeArea(
                          top: false,
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Center(child: _buildSheetHandle()),
                                const SizedBox(height: 16),
                                Row(
                                  children: [
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 12,
                                        vertical: 8,
                                      ),
                                      decoration: BoxDecoration(
                                        color: _statusColor(_status)
                                            .withValues(alpha: 0.12),
                                        borderRadius:
                                            BorderRadius.circular(999),
                                      ),
                                      child: Text(
                                        _statusLabel(_status),
                                        style: GoogleFonts.poppins(
                                          color: _statusColor(_status),
                                          fontWeight: FontWeight.w700,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ),
                                    const Spacer(),
                                    Text(
                                      '₹$fare',
                                      style: GoogleFonts.poppins(
                                        fontSize: 20,
                                        fontWeight: FontWeight.w700,
                                        color: const Color(0xFF0F172A),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 14),
                                Text(
                                  'Live parcel tracking',
                                  style: GoogleFonts.poppins(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w600,
                                    color: const Color(0xFF0F172A),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  driverName.isNotEmpty
                                      ? 'Driver, pickup, and drop route are being tracked live.'
                                      : 'We are preparing your parcel route and delivery updates.',
                                  style: GoogleFonts.poppins(
                                    fontSize: 13,
                                    height: 1.5,
                                    color: const Color(0xFF64748B),
                                  ),
                                ),
                                if (driverName.isNotEmpty) ...[
                                  const SizedBox(height: 16),
                                  Container(
                                    width: double.infinity,
                                    padding: const EdgeInsets.all(16),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFF8FAFC),
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(
                                        color: const Color(0xFFE2E8F0),
                                      ),
                                    ),
                                    child: Row(
                                      children: [
                                        Container(
                                          width: 44,
                                          height: 44,
                                          decoration: BoxDecoration(
                                            color: JT.primary
                                                .withValues(alpha: 0.08),
                                            borderRadius:
                                                BorderRadius.circular(14),
                                          ),
                                          child: const Icon(
                                            Icons.person_outline_rounded,
                                            color: JT.primary,
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                driverName,
                                                style: GoogleFonts.poppins(
                                                  fontSize: 16,
                                                  fontWeight: FontWeight.w600,
                                                  color:
                                                      const Color(0xFF0F172A),
                                                ),
                                              ),
                                              Text(
                                                driverPhone.isNotEmpty
                                                    ? driverPhone
                                                    : 'Driver details available',
                                                style: GoogleFonts.poppins(
                                                  fontSize: 12,
                                                  color:
                                                      const Color(0xFF64748B),
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        if (driverPhone.isNotEmpty)
                                          IconButton(
                                            onPressed: () =>
                                                _launchPhone(driverPhone),
                                            icon: const Icon(
                                              Icons.call_rounded,
                                              color: JT.primary,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                ],
                                const SizedBox(height: 12),
                                _infoCard(
                                  icon: Icons.location_on_outlined,
                                  title: 'Pickup',
                                  value: order?['pickupAddress']?.toString() ??
                                      'Pickup address unavailable',
                                ),
                                const SizedBox(height: 12),
                                ...drops.take(1).map(
                                      (drop) => Padding(
                                        padding:
                                            const EdgeInsets.only(bottom: 12),
                                        child: _infoCard(
                                          icon: Icons.flag_outlined,
                                          title: 'Drop',
                                          value: drop is Map<String, dynamic>
                                              ? (drop['address']?.toString() ??
                                                  'Drop address unavailable')
                                              : 'Drop address unavailable',
                                        ),
                                      ),
                                    ),
                                Row(
                                  children: [
                                    Expanded(
                                      child: _trackingActionButton(
                                        icon: Icons.support_agent_rounded,
                                        label: 'Support',
                                        onTap: _fetchOrder,
                                      ),
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(
                                      child: _canCancel
                                          ? _trackingActionButton(
                                              icon: Icons.close_rounded,
                                              label: _cancelLoading
                                                  ? 'Cancelling...'
                                                  : 'Cancel',
                                              onTap: _cancelLoading
                                                  ? null
                                                  : _cancelOrder,
                                              danger: true,
                                            )
                                          : _trackingActionButton(
                                              icon: Icons.home_rounded,
                                              label: 'Home',
                                              onTap: () =>
                                                  Navigator.pushAndRemoveUntil(
                                                context,
                                                MaterialPageRoute(
                                                  builder: (_) =>
                                                      const MainScreen(),
                                                ),
                                                (_) => false,
                                              ),
                                            ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
    );
  }
}
