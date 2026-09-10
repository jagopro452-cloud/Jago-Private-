import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'live_dot.dart';

/// Pickup/destination progress summary panel — an icon, a label + content
/// slot, an optional distance badge, and an optional live-dot status row.
///
/// Unifies `TrackingScreen._buildInProgressPanel` (heading-to-destination,
/// once the ride has started — shows the distance badge + live-dot footer)
/// and `TrackingScreen._buildHeadingToYouPanel` (pre-pickup, heading to the
/// customer — no distance badge, no footer) into one parameterized widget
/// (Bike/Auto reference implementation).
class RouteProgressPanel extends StatelessWidget {
  final IconData icon;
  final Color accentColor;
  final String label;
  final Widget content;
  final Color backgroundColor;
  final Color? borderColor;
  final Widget? distanceBadge;
  final bool showLiveDot;
  final String? liveDotLabel;
  final Color liveDotLabelColor;
  final IconData? trailingIcon;

  const RouteProgressPanel({
    super.key,
    required this.icon,
    required this.accentColor,
    required this.label,
    required this.content,
    this.backgroundColor = const Color(0xFFF8FAFF),
    this.borderColor,
    this.distanceBadge,
    this.showLiveDot = false,
    this.liveDotLabel,
    this.liveDotLabelColor = Colors.green,
    this.trailingIcon,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: borderColor ?? accentColor.withValues(alpha: 0.1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: accentColor.withValues(alpha: 0.12), shape: BoxShape.circle),
                child: Icon(icon, color: accentColor, size: 20),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label, style: GoogleFonts.poppins(fontSize: 12, color: const Color(0xFF6B7280))),
                    const SizedBox(height: 2),
                    content,
                  ],
                ),
              ),
              if (distanceBadge != null) distanceBadge!,
            ],
          ),
          if (showLiveDot) ...[
            const SizedBox(height: 16),
            const Divider(height: 1),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const LiveDot(),
                    const SizedBox(width: 8),
                    if (liveDotLabel != null)
                      Text(liveDotLabel!,
                          style: GoogleFonts.poppins(
                              fontSize: 12, color: liveDotLabelColor, fontWeight: FontWeight.w600)),
                  ],
                ),
                if (trailingIcon != null) Icon(trailingIcon, color: accentColor, size: 18),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
