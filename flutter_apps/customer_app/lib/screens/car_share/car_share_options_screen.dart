import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';
import '../tracking/local_pool_status_screen.dart';

/// Car Share step 2: 1 or 2 members, then confirm. The customer never
/// chooses a vehicle type — JAGO auto-matches across every eligible pool
/// vehicle once booked. Pickup/drop are already picked (via
/// PremiumLocationScreen's onLocationsConfirmed hand-off) by the time this
/// screen opens.
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

  @override
  void initState() {
    super.initState();
    _fetchEstimate();
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
    return Scaffold(
      backgroundColor: JT.bgSoft,
      appBar: AppBar(
        backgroundColor: JT.bg,
        elevation: 0,
        foregroundColor: JT.textPrimary,
        title: Text('Car Share', style: GoogleFonts.poppins(fontWeight: FontWeight.w700, color: JT.textPrimary)),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _buildTripSummary(),
                  const SizedBox(height: 20),
                  _buildMemberSelector(),
                  const SizedBox(height: 20),
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
            _buildConfirmBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildTripSummary() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
        boxShadow: JT.cardShadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _tripRow(Icons.trip_origin, JT.success, 'Pickup', widget.pickupAddress),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 6, horizontal: 9),
            child: SizedBox(height: 14, child: VerticalDivider(color: JT.border, thickness: 1)),
          ),
          _tripRow(Icons.location_on, JT.error, 'Drop', widget.dropAddress),
        ],
      ),
    );
  }

  Widget _tripRow(IconData icon, Color color, String label, String value) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 18, color: color),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(fontSize: 11, color: JT.textTertiary)),
              Text(value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w600, color: JT.textPrimary)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildMemberSelector() {
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
          Row(
            children: List.generate(_maxSeats, (i) => i + 1).map((n) {
              final selected = _seats == n;
              return Expanded(
                child: GestureDetector(
                  onTap: _loading ? null : () {
                    if (n == _seats) return;
                    setState(() => _seats = n);
                    _fetchEstimate();
                  },
                  child: Container(
                    margin: EdgeInsets.only(right: n == 1 ? 8 : 0, left: n == 2 ? 8 : 0),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    decoration: BoxDecoration(
                      color: selected ? JT.primary : JT.bgSoft,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: selected ? JT.primary : JT.border),
                    ),
                    child: Column(
                      children: [
                        Text('$n',
                            style: GoogleFonts.poppins(
                                fontSize: 20, fontWeight: FontWeight.w800, color: selected ? Colors.white : JT.textPrimary)),
                        const SizedBox(height: 2),
                        Text(n == 1 ? 'Person' : 'People',
                            style: GoogleFonts.poppins(
                                fontSize: 11, color: selected ? Colors.white.withValues(alpha: 0.9) : JT.textSecondary)),
                      ],
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildFareCard() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: JT.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: JT.border),
        boxShadow: JT.cardShadow,
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: JT.primaryLight, shape: BoxShape.circle),
            child: const Icon(Icons.groups_rounded, color: JT.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$_seats ${_seats == 1 ? 'Seat' : 'Seats'} — Rs ${_totalFare.toStringAsFixed(0)}',
                    style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w800, color: JT.textPrimary)),
                const SizedBox(height: 2),
                Text('Rs ${_farePerSeat.toStringAsFixed(0)} per seat • JAGO will match you with a nearby Car Share vehicle',
                    style: const TextStyle(fontSize: 12, color: JT.textSecondary)),
              ],
            ),
          ),
        ],
      ),
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

  Widget _buildConfirmBar() {
    final canConfirm = !_booking && !_loading && _hasEligibleVehicle && _error == null;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      decoration: BoxDecoration(
        color: JT.bg,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 12, offset: const Offset(0, -4))],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          width: double.infinity,
          height: 52,
          child: ElevatedButton(
            onPressed: canConfirm ? _confirm : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: JT.primary,
              disabledBackgroundColor: JT.iconInactive,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            child: _booking
                ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text('Confirm Car Share',
                    style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
          ),
        ),
      ),
    );
  }
}
