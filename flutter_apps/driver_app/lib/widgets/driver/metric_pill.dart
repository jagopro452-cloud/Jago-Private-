import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Small label/value stat display, unifying `TripScreen`'s pill-style
/// metric (formerly `_pill`) and `LocalPoolScreen`'s stacked metric
/// (formerly `_metric`) into one widget.
///
/// - `compact: true` (default) renders the tinted, bordered pill used by
///   `TripScreen`'s fare/distance/pay row: a centered column with the value
///   on top (colored) and the label below it.
/// - `compact: false` renders the plain stacked column used by
///   `LocalPoolScreen`'s metrics row: left-aligned label on top, larger
///   neutral-colored value below — `color` is ignored in this mode, exactly
///   as the original `_metric` always rendered its value in
///   `JT.textPrimary` regardless of context.
class MetricPill extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final bool compact;

  const MetricPill({
    super.key,
    required this.label,
    required this.value,
    this.color = JT.primary,
    this.compact = true,
  });

  @override
  Widget build(BuildContext context) {
    if (!compact) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary)),
          const SizedBox(height: 4),
          Text(value, style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w600, color: JT.textPrimary)),
        ],
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.15)),
      ),
      child: Column(children: [
        Text(value,
            style: GoogleFonts.poppins(color: color, fontSize: 13, fontWeight: FontWeight.w500)),
        const SizedBox(height: 2),
        Text(label,
            style: GoogleFonts.poppins(color: JT.textSecondary, fontSize: 9, fontWeight: FontWeight.w400)),
      ]),
    );
  }
}
