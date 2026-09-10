import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Reusable live-status banner: an icon chip, a title/subtitle pair, and an
/// optional pulsing "LIVE"-style badge, all tinted by [color].
///
/// Extracted from `TripScreen`'s pickup-phase / in-progress banner (formerly
/// `_buildStageStrip`, built just above `_buildLiveStats`) — e.g. "Customer
/// Verified Location" while heading to/at pickup, switching to "Trip in
/// Progress" with a LIVE badge once the trip is under way. `LocalPoolScreen`
/// doesn't have a matching state yet, so it isn't wired up there; this is
/// extracted cleanly from `TripScreen` for future reuse (e.g. a "matching
/// live" pool banner).
class LiveStatusBanner extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Color color;
  final bool showLiveBadge;
  final String liveBadgeText;

  const LiveStatusBanner({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    required this.color,
    this.showLiveBadge = false,
    this.liveBadgeText = 'LIVE',
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Row(children: [
        Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: color, size: 20),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title,
                style: GoogleFonts.poppins(
                    color: color, fontSize: 14, fontWeight: FontWeight.w700)),
            if ((subtitle ?? '').trim().isNotEmpty)
              Text(subtitle!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(
                      color: JT.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w500)),
          ]),
        ),
        if (showLiveBadge)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(18),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              const Icon(Icons.circle, color: JT.success, size: 8),
              const SizedBox(width: 5),
              Text(liveBadgeText,
                  style: GoogleFonts.poppins(
                      color: color, fontSize: 10, fontWeight: FontWeight.w700)),
            ]),
          ),
      ]),
    );
  }
}
