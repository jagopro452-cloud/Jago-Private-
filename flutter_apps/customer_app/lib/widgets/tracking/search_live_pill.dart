import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// "Live | X nearby" pill shown on the searching screen.
///
/// Extracted verbatim from `TrackingScreen._buildSearchLivePill` (Bike/Auto
/// reference implementation). The trailing wording after the divider is
/// parameterized via [nearbyLabel] so callers can say e.g. "12 pilots
/// nearby" (Bike/Auto) or "pooled drivers nearby" (Car Share).
class SearchLivePill extends StatelessWidget {
  final AnimationController controller;
  final String nearbyLabel;
  final Color accentColor;

  const SearchLivePill({
    super.key,
    required this.controller,
    required this.nearbyLabel,
    this.accentColor = const Color(0xFF10B981),
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: accentColor.withValues(alpha: 0.3)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AnimatedBuilder(
                animation: controller,
                builder: (context, child) => Container(
                  width: 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: accentColor.withValues(alpha: 0.5 + controller.value * 0.5),
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
                  color: accentColor,
                ),
              ),
              const SizedBox(width: 5),
              Text('|', style: GoogleFonts.poppins(fontSize: 11, color: const Color(0xFFCBD5E1))),
              const SizedBox(width: 5),
              Text(
                nearbyLabel,
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
}
