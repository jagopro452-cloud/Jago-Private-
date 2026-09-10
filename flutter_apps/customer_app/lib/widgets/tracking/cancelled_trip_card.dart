import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Cancelled/no-rides-found state card — broken-connection icon, title,
/// subtitle, a primary action button, an optional "Tip" callout, and an
/// optional footer slot.
///
/// Extracted verbatim from `TrackingScreen._buildCancelledCard` (Bike/Auto
/// reference implementation).
class CancelledTripCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final String primaryButtonLabel;
  final VoidCallback onPrimaryButtonTap;
  final Color accentColor;
  final String? tipText;
  final Widget? footer;

  const CancelledTripCard({
    super.key,
    required this.title,
    required this.subtitle,
    required this.primaryButtonLabel,
    required this.onPrimaryButtonTap,
    this.accentColor = const Color(0xFF2C95F1),
    this.tipText = 'You can try again after some time, or check different ride options.',
    this.footer,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SizedBox(
          width: 84,
          height: 84,
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: 62,
                height: 62,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: accentColor.withValues(alpha: 0.06),
                  border: Border.all(color: accentColor, width: 4.5),
                ),
                child: Icon(Icons.sentiment_dissatisfied_rounded, size: 30, color: accentColor),
              ),
              Positioned(
                right: 2,
                bottom: 4,
                child: Transform.rotate(
                  angle: 0.78,
                  child: Container(
                    width: 20,
                    height: 6,
                    decoration: BoxDecoration(color: accentColor, borderRadius: BorderRadius.circular(3)),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Text(
          title,
          textAlign: TextAlign.center,
          style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w700, color: const Color(0xFF0F172A)),
        ),
        const SizedBox(height: 6),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: GoogleFonts.poppins(fontSize: 12.5, color: const Color(0xFF64748B), height: 1.4),
        ),
        const SizedBox(height: 18),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: onPrimaryButtonTap,
            icon: const Icon(Icons.refresh_rounded, size: 18, color: Colors.white),
            label: Text(primaryButtonLabel,
                style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white)),
            style: ElevatedButton.styleFrom(
              backgroundColor: accentColor,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
          ),
        ),
        if (tipText != null) ...[
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: accentColor.withValues(alpha: 0.06),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.lightbulb_outline_rounded, size: 18, color: accentColor),
                const SizedBox(width: 8),
                Expanded(
                  child: RichText(
                    text: TextSpan(
                      style: GoogleFonts.poppins(fontSize: 11.5, color: const Color(0xFF475569), height: 1.4),
                      children: [
                        const TextSpan(
                          text: 'Tip: ',
                          style: TextStyle(fontWeight: FontWeight.w700, color: Color(0xFF1E293B)),
                        ),
                        TextSpan(text: tipText),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        if (footer != null) ...[
          const SizedBox(height: 14),
          footer!,
        ],
      ],
    );
  }
}
