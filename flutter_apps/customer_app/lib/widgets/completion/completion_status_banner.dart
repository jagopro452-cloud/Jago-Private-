import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Gradient status banner shown at the top of trip/ride completion & rating
/// screens (e.g. `TripCompletionScreen`, `PoolRatingScreen`) to announce the
/// trip status.
class CompletionStatusBanner extends StatelessWidget {
  final Gradient gradient;
  final Color shadowColor;
  final String title;
  final String subtitle;
  final IconData icon;

  const CompletionStatusBanner({
    super.key,
    required this.gradient,
    required this.shadowColor,
    required this.title,
    required this.subtitle,
    this.icon = Icons.stars_rounded,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 20),
      decoration: BoxDecoration(
        gradient: gradient,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: shadowColor.withValues(alpha: 0.22),
            blurRadius: 15,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: Colors.white, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.poppins(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
                Text(
                  subtitle,
                  style: GoogleFonts.poppins(
                    color: Colors.white.withValues(alpha: 0.8),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
