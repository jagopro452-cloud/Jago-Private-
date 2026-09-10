import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;
import 'package:jago_shared_core/jago_shared_core.dart';
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../core/map_night_style.dart';
import '../../services/auth_service.dart';
import '../tracking/local_pool_status_screen.dart';

/// Car Share step 2: 1 or 2 members, then confirm. The customer never
/// chooses a vehicle type — JAGO auto-matches across every eligible pool
/// vehicle once booked. Pickup/drop are already picked (via
/// PremiumLocationScreen's onLocationsConfirmed hand-off) by the time this
/// screen opens.
///
/// Bespoke layout (compact white header + fixed-height map + scrollable
/// pickup/drop + passenger + fare + pinned CTA) rather than the shared
/// [BookingMapShell] Bike/Auto/Cab/Premium use — that shell is a full-bleed
/// map with a floating header card and an overlaid sheet, structurally
/// different from what this screen needs (a solid header bar, a map that's
/// only ~38% of the screen, a solid bottom section below it) and is left
/// completely untouched for those other flows. Matches the visual language
/// (colors, radii, map style) of the other redesigned Car Share screens —
/// LocalPoolStatusScreen's searching/live-tracking states and the driver
/// app's Local Pool screen. Every API call, seat-limit check, and
/// navigation target below is unchanged from before this UI rebuild.
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
  // Straight-line pickup-to-drop distance, from the same estimate call —
  // real data (server's haversineKmPool), not invented. No duration field
  // exists on this endpoint, so ETA is the same lightweight constant-speed
  // estimate used on the other redesigned Car Share screens.
  double? _distanceKm;

  GoogleMapController? _mapController;
  BitmapDescriptor? _pickupIcon;
  BitmapDescriptor? _dropIcon;

  LatLng get _pickupLatLng => LatLng(widget.pickupLat, widget.pickupLng);
  LatLng get _dropLatLng => LatLng(widget.dropLat, widget.dropLng);

  int? get _etaMinutes {
    final km = _distanceKm;
    if (km == null) return null;
    return (km / 25 * 60).ceil().clamp(1, 999);
  }

  Set<Polyline> get _routePolylines => {
        Polyline(
          polylineId: const PolylineId('car_share_preview_route'),
          points: [_pickupLatLng, _dropLatLng],
          color: JT.primary,
          width: 4,
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
        ),
      };

  @override
  void initState() {
    super.initState();
    _fetchEstimate();
    _loadMarkerIcons();
  }

  Future<void> _loadMarkerIcons() async {
    final pickup = await JagoMapMarkers.pickup();
    final drop = await JagoMapMarkers.destination();
    if (!mounted) return;
    setState(() {
      _pickupIcon = pickup;
      _dropIcon = drop;
    });
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
          _distanceKm = (d['distanceKm'] as num?)?.toDouble();
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
    final canConfirm = !_booking && !_loading && _hasEligibleVehicle && _error == null;
    final mapHeight = (MediaQuery.of(context).size.height * 0.36).clamp(220.0, 340.0);

    return Scaffold(
      backgroundColor: const Color(0xFFF0F7FF),
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            SizedBox(height: mapHeight, child: _buildMap()),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildPickupDropCard(),
                    const SizedBox(height: 14),
                    _buildPassengerSelector(),
                    const SizedBox(height: 14),
                    if (_loading)
                      _buildLoadingFareState()
                    else if (_error != null)
                      _buildErrorState()
                    else if (!_hasEligibleVehicle)
                      _buildEmptyState()
                    else
                      _buildFareSummaryCard(),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: _buildConfirmButton(canConfirm),
            ),
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _buildSafetyFooter(),
            ),
          ],
        ),
      ),
    );
  }

  // ── Header ─────────────────────────────────────────────────────────────

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 10, 16, 10),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_rounded, color: JT.textPrimary),
            onPressed: () => Navigator.pop(context),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Car Share', style: GoogleFonts.poppins(fontSize: 19, fontWeight: FontWeight.w700, color: JT.textPrimary)),
              Text('Affordable rides, together', style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
            ],
          ),
          const Spacer(),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(color: JT.success.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.eco_rounded, color: JT.success, size: 14),
                const SizedBox(width: 5),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Save more', style: GoogleFonts.poppins(fontSize: 9.5, fontWeight: FontWeight.w700, color: JT.success)),
                    Text('Ride together', style: GoogleFonts.poppins(fontSize: 9, color: JT.success)),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Map ────────────────────────────────────────────────────────────────

  Widget _buildMap() {
    final etaMin = _etaMinutes;
    return ClipRRect(
      borderRadius: BorderRadius.circular(20),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 16),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(20)),
        child: Stack(
          children: [
            Positioned.fill(
              child: GoogleMap(
                initialCameraPosition: CameraPosition(target: _pickupLatLng, zoom: 14),
                style: Theme.of(context).brightness == Brightness.dark ? kMapNightStyle : null,
                onMapCreated: (c) {
                  _mapController = c;
                  _fitMapToRoute();
                },
                markers: {
                  Marker(
                    markerId: const MarkerId('pickup'),
                    position: _pickupLatLng,
                    infoWindow: const InfoWindow(title: 'Pickup'),
                    icon: _pickupIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
                  ),
                  Marker(
                    markerId: const MarkerId('destination'),
                    position: _dropLatLng,
                    infoWindow: const InfoWindow(title: 'Drop'),
                    icon: _dropIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
                  ),
                },
                polylines: _routePolylines,
                myLocationEnabled: false,
                myLocationButtonEnabled: false,
                zoomControlsEnabled: false,
                mapToolbarEnabled: false,
                compassEnabled: false,
              ),
            ),
            if (_distanceKm != null)
              Positioned(
                top: 12,
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.12), blurRadius: 12, offset: const Offset(0, 4))],
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '${_distanceKm!.toStringAsFixed(1)} km${etaMin != null ? ' • $etaMin min' : ''}',
                          style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w700, color: JT.textPrimary),
                        ),
                        Text('Shared ride', style: GoogleFonts.poppins(fontSize: 10.5, color: JT.textSecondary)),
                      ],
                    ),
                  ),
                ),
              ),
            Positioned(
              bottom: 12,
              right: 12,
              child: GestureDetector(
                onTap: _fitMapToRoute,
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.12), blurRadius: 10, offset: const Offset(0, 4))],
                  ),
                  child: const Icon(Icons.my_location_rounded, color: JT.primary, size: 18),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Pickup / drop ──────────────────────────────────────────────────────

  // Splits a single formatted address string into a bold "name" line and a
  // secondary "locality" line wherever it contains a comma — both pickup and
  // drop are still the exact real address strings passed into this screen,
  // just laid out across two lines instead of one when they naturally split.
  (String, String?) _splitAddress(String address) {
    final idx = address.indexOf(',');
    if (idx <= 0 || idx >= address.length - 1) return (address, null);
    return (address.substring(0, idx).trim(), address.substring(idx + 1).trim());
  }

  Widget _buildPickupDropCard() {
    final (pickupPrimary, pickupSecondary) = _splitAddress(widget.pickupAddress);
    final (dropPrimary, dropSecondary) = _splitAddress(widget.dropAddress);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: JT.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _addressBlock('PICKUP', JT.primary, pickupPrimary, pickupSecondary),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Divider(height: 1),
          ),
          _addressBlock('DROP', JT.error, dropPrimary, dropSecondary),
        ],
      ),
    );
  }

  Widget _addressBlock(String label, Color color, String primary, String? secondary) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 3),
          child: Icon(Icons.circle, color: color, size: 9),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: GoogleFonts.poppins(fontSize: 10, fontWeight: FontWeight.w700, color: color, letterSpacing: 0.5)),
              const SizedBox(height: 2),
              Text(primary,
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(fontSize: 14.5, fontWeight: FontWeight.w700, color: JT.textPrimary)),
              if (secondary != null && secondary.isNotEmpty)
                Text(secondary,
                    maxLines: 1, overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
            ],
          ),
        ),
      ],
    );
  }

  // ── Passenger selector ─────────────────────────────────────────────────

  Widget _buildPassengerSelector() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Passengers', style: GoogleFonts.poppins(fontSize: 14.5, fontWeight: FontWeight.w700, color: JT.textPrimary)),
            Text('Max $_maxSeats', style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: List.generate(_maxSeats, (i) => i + 1).map((n) {
            final selected = _seats == n;
            return Expanded(
              child: Padding(
                padding: EdgeInsets.only(right: n == _maxSeats ? 0 : 10),
                child: _passengerCard(n, selected),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  Widget _passengerCard(int n, bool selected) {
    return GestureDetector(
      onTap: _loading
          ? null
          : () {
              if (n == _seats) return;
              setState(() => _seats = n);
              _fetchEstimate();
            },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 10),
        decoration: BoxDecoration(
          color: selected ? JT.primary.withValues(alpha: 0.06) : Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: selected ? JT.primary : JT.border, width: selected ? 1.6 : 1),
        ),
        child: Stack(
          children: [
            Column(
              children: [
                Icon(
                  n == 1 ? Icons.person_rounded : Icons.people_alt_rounded,
                  color: selected ? JT.primary : JT.textSecondary,
                  size: 26,
                ),
                const SizedBox(height: 8),
                Text(
                  n == 1 ? '1 Person' : '2 People',
                  style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w700, color: JT.textPrimary),
                ),
                const SizedBox(height: 2),
                Text(
                  n == 1 ? 'Just you' : 'You + companion',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.poppins(fontSize: 11, color: JT.textSecondary),
                ),
              ],
            ),
            if (selected)
              Positioned(
                top: 0,
                right: 0,
                child: Container(
                  width: 20,
                  height: 20,
                  decoration: const BoxDecoration(color: JT.primary, shape: BoxShape.circle),
                  child: const Icon(Icons.check_rounded, color: Colors.white, size: 13),
                ),
              ),
          ],
        ),
      ),
    );
  }

  // ── Fare / loading / error / empty ────────────────────────────────────

  Widget _buildFareSummaryCard() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: JT.success.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: JT.success.withValues(alpha: 0.18)),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(color: JT.success.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
            child: const Icon(Icons.directions_car_filled_rounded, color: JT.success, size: 19),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Car Share', style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w700, color: JT.textPrimary)),
                Text(
                  _seats > 1 ? 'Shared ride · ₹${_farePerSeat.toStringAsFixed(0)}/seat' : 'Shared ride · Saves more',
                  style: GoogleFonts.poppins(fontSize: 11.5, color: JT.textSecondary),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('₹${_totalFare.toStringAsFixed(0)}', style: GoogleFonts.poppins(fontSize: 17, fontWeight: FontWeight.w800, color: JT.textPrimary)),
              Text('Estimated fare', style: GoogleFonts.poppins(fontSize: 10, color: JT.textSecondary)),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildLoadingFareState() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: JT.border)),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2, color: JT.primary)),
          const SizedBox(width: 12),
          Text('Calculating fare...', style: GoogleFonts.poppins(fontSize: 13, color: JT.textSecondary)),
        ],
      ),
    );
  }

  Widget _buildErrorState() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: JT.border)),
      child: Column(
        children: [
          const Icon(Icons.error_outline_rounded, color: JT.error, size: 28),
          const SizedBox(height: 8),
          Text('Unable to confirm trip', style: GoogleFonts.poppins(fontSize: 13.5, fontWeight: FontWeight.w600, color: JT.textPrimary)),
          const SizedBox(height: 2),
          Text(_error ?? 'Please try again.', textAlign: TextAlign.center, style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
          const SizedBox(height: 8),
          TextButton(onPressed: _fetchEstimate, child: const Text('Retry')),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 16),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(18), border: Border.all(color: JT.border)),
      child: Column(
        children: [
          const Icon(Icons.no_transfer_rounded, color: JT.textTertiary, size: 28),
          const SizedBox(height: 8),
          Text('No Car Share vehicles available right now.',
              textAlign: TextAlign.center, style: GoogleFonts.poppins(fontSize: 12.5, color: JT.textSecondary)),
        ],
      ),
    );
  }

  // ── CTA / footer ───────────────────────────────────────────────────────

  Widget _buildConfirmButton(bool canConfirm) {
    return SizedBox(
      width: double.infinity,
      height: 56,
      child: ElevatedButton(
        onPressed: canConfirm ? _confirm : null,
        style: ElevatedButton.styleFrom(
          backgroundColor: JT.primary,
          disabledBackgroundColor: JT.border,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          elevation: 0,
        ),
        child: _booking
            ? Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white)),
                  const SizedBox(width: 10),
                  Text('Confirming...', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.white)),
                ],
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text('Confirm Trip', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600, color: Colors.white)),
                  if (!_loading && _hasEligibleVehicle && _error == null) ...[
                    const SizedBox(width: 10),
                    Container(width: 1, height: 16, color: Colors.white.withValues(alpha: 0.35)),
                    const SizedBox(width: 10),
                    Text('₹${_totalFare.toStringAsFixed(0)}', style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
                    const SizedBox(width: 6),
                    const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 18),
                  ],
                ],
              ),
      ),
    );
  }

  Widget _buildSafetyFooter() {
    return Center(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.shield_outlined, size: 11, color: Color(0xFF9CA3AF)),
          const SizedBox(width: 5),
          Text('Safe. Affordable. Greener together.',
              style: GoogleFonts.poppins(fontSize: 10, color: const Color(0xFF9CA3AF))),
        ],
      ),
    );
  }
}
