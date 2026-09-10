import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import '../../src/core/config/api_config.dart';
import '../../config/jago_theme.dart';
import '../../services/auth_service.dart';

/// Inline "Shared Ride / Carpool" comparison card shown alongside the
/// private vehicle tiles on the main booking screen. Independently fetches
/// its own Car Share estimate (the same `pool/estimate` call
/// `CarShareOptionsScreen` already makes) so it never touches the private
/// ride fare-selection state (`_allFares`/`_selectedFareIndex`) — tapping it
/// hands off straight into the existing `CarShareOptionsScreen` flow rather
/// than duplicating any booking logic here.
///
/// Renders nothing while there's no eligible Car Share vehicle on this
/// route, rather than showing a card with a fabricated seat count or ETA the
/// backend doesn't actually provide.
class SharedRideCard extends StatefulWidget {
  final double pickupLat;
  final double pickupLng;
  final double dropLat;
  final double dropLng;
  final double? comparisonFare;
  final VoidCallback onTap;

  const SharedRideCard({
    super.key,
    required this.pickupLat,
    required this.pickupLng,
    required this.dropLat,
    required this.dropLng,
    required this.comparisonFare,
    required this.onTap,
  });

  @override
  State<SharedRideCard> createState() => _SharedRideCardState();
}

class _SharedRideCardState extends State<SharedRideCard> {
  bool _loading = true;
  bool _hasEligibleVehicle = false;
  double _totalFare = 0;

  @override
  void initState() {
    super.initState();
    _fetchEstimate();
  }

  Future<void> _fetchEstimate() async {
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
              'seatsRequested': 1,
            }),
          )
          .timeout(const Duration(seconds: 15));
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      if (!mounted) return;
      if (res.statusCode == 200 && data['success'] == true) {
        final d = data['data'] as Map<String, dynamic>? ?? {};
        setState(() {
          _totalFare = (d['totalFare'] as num?)?.toDouble() ?? 0;
          _hasEligibleVehicle = d['hasEligibleVehicle'] == true;
          _loading = false;
        });
      } else {
        setState(() => _loading = false);
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: JT.border),
        ),
        child: Row(
          children: [
            const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: JT.primary)),
            const SizedBox(width: 14),
            Text('Checking Shared Ride availability...', style: GoogleFonts.poppins(fontSize: 12.5, color: JT.textSecondary)),
          ],
        ),
      );
    }
    if (!_hasEligibleVehicle || _totalFare <= 0) return const SizedBox.shrink();

    final comparison = widget.comparisonFare;
    final savings = (comparison != null && comparison > _totalFare) ? comparison - _totalFare : 0.0;

    return GestureDetector(
      onTap: widget.onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF7C3AED).withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFF7C3AED).withValues(alpha: 0.25)),
        ),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: const Color(0xFF7C3AED).withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(16),
              ),
              child: const Icon(Icons.groups_rounded, color: Color(0xFF7C3AED), size: 28),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text('Shared Ride', style: GoogleFonts.poppins(fontSize: 15.5, fontWeight: FontWeight.w700, color: const Color(0xFF1E293B))),
                      const SizedBox(width: 8),
                      Text('₹${_totalFare.toStringAsFixed(0)}', style: GoogleFonts.poppins(fontSize: 15.5, fontWeight: FontWeight.w700, color: const Color(0xFF7C3AED))),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    savings > 0
                        ? 'Save ₹${savings.toStringAsFixed(0)} · JAGO matches you with a nearby pool vehicle'
                        : 'JAGO matches you with a nearby pool vehicle',
                    style: GoogleFonts.poppins(fontSize: 11.5, color: const Color(0xFF64748B)),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: Color(0xFF7C3AED)),
          ],
        ),
      ),
    );
  }
}
