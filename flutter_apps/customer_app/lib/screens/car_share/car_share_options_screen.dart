import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../../widgets/booking/address_row.dart';
import '../../widgets/booking/booking_map_shell.dart';
import '../../widgets/booking/inline_info_card.dart';
import '../tracking/local_pool_status_screen.dart';

/// Car Share step 2: 1 or 2 members, then confirm. The customer never
/// chooses a vehicle type — JAGO auto-matches across every eligible pool
/// vehicle once booked. Pickup/drop are already picked (via
/// PremiumLocationScreen's onLocationsConfirmed hand-off) by the time this
/// screen opens.
///
/// Rendered on [BookingMapShell] — the same map + bottom-sheet shell used by
/// Bike/Auto/Cab/Premium's BookingScreen — as a single-step (`totalSteps: 1`)
/// flow, so the layout, cards, and CTA button match that flow exactly. Every
/// API call, seat-limit check, and navigation target below is unchanged from
/// before this UI rebuild.
class CarShareOptionsScreen extends StatefulWidget {
  final String pickupAddress;
  final double pickupLat;
  final double pickupLng;
  final String dropAddress;
  final double dropLat;
  final double dropLng;

  const CarShareOptionsScreen({
    super.key,
    required this.pickupAddress,
    required this.pickupLat,
    required this.pickupLng,
    required this.dropAddress,
    required this.dropLat,
    required this.dropLng,
  });

  @override
  State<CarShareOptionsScreen> createState() => _CarShareOptionsScreenState();
}

class _CarShareOptionsScreenState extends State<CarShareOptionsScreen> {
  // Hard business rule, mirrored server-side in MAX_SEATS_PER_CAR_SHARE_BOOKING
  // (server/rolling-pool.ts) — one Car Share booking is always 1 or 2 seats,
  // regardless of the matched vehicle's actual capacity. Not configurable.
  static const int _maxSeats = 2;

  int _seats = 1;
  bool _loading = true;
  bool _booking = false;
  String? _error;
  bool _hasEligibleVehicle = true;
  double _farePerSeat = 0;
  double _totalFare = 0;

  GoogleMapController? _mapController;

  LatLng get _pickupLatLng => LatLng(widget.pickupLat, widget.pickupLng);
  LatLng get _dropLatLng => LatLng(widget.dropLat, widget.dropLng);

  @override
  void initState() {
    super.initState();
    _fetchEstimate();
  }

  void _fitMapToRoute() {
    final controller = _mapController;
    if (controller == null) return;
    Future.delayed(const Duration(milliseconds: 300), () {
      final minLat = _pickupLatLng.latitude < _dropLatLng.latitude ? _pickupLatLng.latitude : _dropLatLng.latitude;
      final maxLat = _pickupLatLng.latitude > _dropLatLng.latitude ? _pickupLatLng.latitude : _dropLatLng.latitude;
      final minLng = _pickupLatLng.longitude < _dropLatLng.longitude ? _pickupLatLng.longitude : _dropLatLng.longitude;
      final maxLng = _pickupLatLng.longitude > _dropLatLng.longitude ? _pickupLatLng.longitude : _dropLatLng.longitude;
      try {
        controller.animateCamera(CameraUpdate.newLatLngBounds(
          LatLngBounds(
            southwest: LatLng(minLat, minLng),
            northeast: LatLng(maxLat, maxLng),
          ),
          90,
        ));
      } catch (_) {}
    });
  }

  Future<void> _fetchEstimate() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final headers = await AuthService.getHeaders();
      final res = await http
          .post(
            Uri.parse(ApiConfig.localPoolEstimate),
            headers: headers,
            body: jsonEncode({
              'pickupLat': widget.pickupLat,
              'pickupLng': widget.pickupLng,
              'dropLat': widget.dropLat,
              'dropLng': widget.dropLng,
              'seatsRequested': _seats,
            }),
          )
          .timeout(const Duration(seconds: 15));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode == 200 && data['success'] == true) {
        final d = data['data'] as Map<String, dynamic>? ?? {};
        if (!mounted) return;
        setState(() {
          _farePerSeat = (d['farePerSeat'] as num?)?.toDouble() ?? 0;
          _totalFare = (d['totalFare'] as num?)?.toDouble() ?? 0;
          _hasEligibleVehicle = d['hasEligibleVehicle'] != false;
          _loading = false;
        });
      } else {
        if (!mounted) return;
        setState(() {
          _error = data['message']?.toString() ?? 'Could not load Car Share estimate';
          _loading = false;
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Network error. Please try again.';
        _loading = false;
      });
    }
  }

  Future<void> _confirm() async {
    if (_booking || _loading || !_hasEligibleVehicle) return;
    setState(() => _booking = true);
    try {
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
              'seatsRequested': _seats,
              // No vehicleCategoryId — JAGO auto-matches the vehicle.
            }),
          )
          .timeout(const Duration(seconds: 20));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final requestId = data['data']?['requestId']?.toString();
      if (res.statusCode == 200 && data['success'] == true && requestId != null) {
        if (!mounted) return;
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => LocalPoolStatusScreen(
              requestId: requestId,
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
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(data['message']?.toString() ?? 'Could not book Car Share'),
        backgroundColor: JT.error,
      ));
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Network error. Please try again.'),
        backgroundColor: JT.error,
      ));
    } finally {
      if (mounted) setState(() => _booking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final screenHeight = MediaQuery.of(context).size.height;
    final canConfirm = !_booking && !_loading && _hasEligibleVehicle && _error == null;

    return Scaffold(
      backgroundColor: JT.bg,
      body: BookingMapShell(
        pickupLatLng: _pickupLatLng,
        markers: {
          Marker(
            markerId: const MarkerId('pickup'),
            position: _pickupLatLng,
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
          ),
          Marker(
            markerId: const MarkerId('destination'),
            position: _dropLatLng,
            icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
          ),
        },
        polylines: const {},
        onMapCreated: (c) {
          _mapController = c;
          _fitMapToRoute();
        },
        onRecenter: () => _fitMapToRoute(),
        title: 'Car Share',
        subtitle: 'JAGO matches you with a nearby pool vehicle.',
        totalSteps: 1,
        currentStep: 0,
        sheetMaxHeight: screenHeight * 0.62,
        stepBody: SingleChildScrollView(
          key: const ValueKey('carShare'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildTripSummary(),
              const SizedBox(height: 16),
              _buildMemberSelector(),
              const SizedBox(height: 16),
              if (_loading)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: Center(child: CircularProgressIndicator(color: JT.primary)),
                )
              else if (_error != null)
                _buildErrorState()
              else if (!_hasEligibleVehicle)
                _buildEmptyState()
              else
                _buildFareCard(),
            ],
          ),
        ),
        stepBodyKey: 'carShare',
        ctaLabel: 'Confirm Car Share',
        onCtaPressed: canConfirm ? _confirm : null,
        ctaLoading: _booking,
      ),
    );
  }

  Widget _buildTripSummary() {
    return Container(
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
        boxShadow: JT.cardShadow,
      ),
      child: Column(
        children: [
          AddressRow(icon: Icons.circle_rounded, color: JT.primary, text: widget.pickupAddress, isPickup: true),
          const Divider(height: 1, indent: 52, endIndent: 16),
          AddressRow(icon: Icons.location_on_rounded, color: JT.error, text: widget.dropAddress, isPickup: false),
        ],
      ),
    );
  }

  Widget _buildMemberSelector() {
    const Color selColor = Color(0xFF7C3AED); // matches booking_screen's selected vehicle-tile accent
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
        boxShadow: JT.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('How many members are travelling?',
              style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w700, color: JT.textPrimary)),
          const SizedBox(height: 12),
          ...List.generate(_maxSeats, (i) => i + 1).map((n) {
            final selected = _seats == n;
            return Padding(
              padding: EdgeInsets.only(bottom: n == _maxSeats ? 0 : 12),
              child: GestureDetector(
                onTap: _loading
                    ? null
                    : () {
                        if (n == _seats) return;
                        setState(() => _seats = n);
                        _fetchEstimate();
                      },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: selected ? selColor.withValues(alpha: 0.06) : Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: selected ? selColor.withValues(alpha: 0.3) : JT.border,
                      width: selected ? 2 : 1,
                    ),
                    boxShadow: selected
                        ? [BoxShadow(color: selColor.withValues(alpha: 0.08), blurRadius: 12, offset: const Offset(0, 4))]
                        : [BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 5, offset: const Offset(0, 2))],
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 70,
                        height: 70,
                        decoration: BoxDecoration(
                          color: selected ? selColor.withValues(alpha: 0.1) : const Color(0xFFF9FAFB),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Center(
                          child: Text(
                            '$n',
                            style: GoogleFonts.poppins(
                              fontSize: 28,
                              fontWeight: FontWeight.w800,
                              color: selected ? selColor : const Color(0xFF1E293B),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              n == 1 ? '1 Person' : '2 People',
                              style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700, color: const Color(0xFF1E293B)),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              n == 1 ? 'Just you' : 'You and a companion',
                              style: GoogleFonts.poppins(
                                color: selected ? selColor : const Color(0xFF64748B),
                                fontSize: 13,
                                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (selected) ...[
                        const SizedBox(width: 10),
                        Container(
                          width: 26,
                          height: 26,
                          decoration: const BoxDecoration(color: Color(0xFF7C3AED), shape: BoxShape.circle),
                          child: const Icon(Icons.check_rounded, color: Colors.white, size: 16),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildFareCard() {
    return InlineInfoCard(
      icon: Icons.groups_rounded,
      title: '$_seats ${_seats == 1 ? 'Seat' : 'Seats'} — Rs ${_totalFare.toStringAsFixed(0)}',
      subtitle: 'Rs ${_farePerSeat.toStringAsFixed(0)} per seat • JAGO will match you with a nearby Car Share vehicle',
    );
  }

  Widget _buildErrorState() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 16),
      decoration: BoxDecoration(color: JT.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: JT.border)),
      child: Column(
        children: [
          const Icon(Icons.error_outline_rounded, color: JT.error, size: 36),
          const SizedBox(height: 10),
          Text(_error ?? '', textAlign: TextAlign.center, style: const TextStyle(color: JT.textSecondary)),
          const SizedBox(height: 12),
          TextButton(onPressed: _fetchEstimate, child: const Text('Retry')),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 30, horizontal: 16),
      decoration: BoxDecoration(color: JT.surface, borderRadius: BorderRadius.circular(16), border: Border.all(color: JT.border)),
      child: Column(
        children: [
          const Icon(Icons.no_transfer_rounded, color: JT.textTertiary, size: 36),
          const SizedBox(height: 10),
          const Text('No Car Share vehicles available right now.',
              textAlign: TextAlign.center, style: TextStyle(color: JT.textSecondary)),
        ],
      ),
    );
  }
}
