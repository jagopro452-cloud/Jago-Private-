import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Top-of-sheet "searching" layout — title/subtitle/eta row, live pill,
/// stage stepper, up to two info cards, a cancel button and an optional
/// footer.
///
/// Extracted verbatim (structure/spacing) from
/// `TrackingScreen._buildSearchingView` (Bike/Auto reference
/// implementation). Deliberately has no outer card decoration of its own —
/// in Bike/Auto it renders directly inside the already-styled bottom
/// sheet, and Car Share's rebuild relies on that same lack of an extra box
/// to visually match.
class SearchingHeroCard extends StatelessWidget {
  final Widget pulseIcon;
  final String title;
  final String subtitle;
  final String? etaValue;
  final String etaLabel;
  final Widget livePill;
  final Widget stageStepper;
  final Widget primaryInfoCard;
  final Widget? secondaryInfoCard;
  final Widget cancelButton;
  final Widget? footer;

  const SearchingHeroCard({
    super.key,
    required this.pulseIcon,
    required this.title,
    required this.subtitle,
    this.etaValue,
    this.etaLabel = 'min away',
    required this.livePill,
    required this.stageStepper,
    required this.primaryInfoCard,
    this.secondaryInfoCard,
    required this.cancelButton,
    this.footer,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            pulseIcon,
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.poppins(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F172A),
                      height: 1.15,
                      letterSpacing: -0.2,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.poppins(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w400,
                      color: const Color(0xFF64748B),
                      height: 1.25,
                    ),
                  ),
                ],
              ),
            ),
            if (etaValue != null) ...[
              const SizedBox(width: 6),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    etaValue!,
                    style: GoogleFonts.poppins(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF2C95F1),
                      height: 1.0,
                    ),
                  ),
                  Text(
                    etaLabel,
                    style: GoogleFonts.poppins(
                      fontSize: 9,
                      fontWeight: FontWeight.w500,
                      color: const Color(0xFF64748B),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
        const SizedBox(height: 8),
        livePill,
        const SizedBox(height: 8),
        stageStepper,
        const SizedBox(height: 8),
        if (secondaryInfoCard != null)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: primaryInfoCard),
              const SizedBox(width: 8),
              Expanded(child: secondaryInfoCard!),
            ],
          )
        else
          primaryInfoCard,
        const SizedBox(height: 10),
        cancelButton,
        if (footer != null) ...[
          const SizedBox(height: 6),
          footer!,
        ],
      ],
    );
  }
}
