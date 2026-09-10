import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Sheet-top status header: status label (+ optional "Live tracking •
/// Secure" badge), an optional trailing actions slot (share/more-menu),
/// and — when an OTP is supplied — the PIN + ETA card pair beneath it.
///
/// Extracted verbatim from `TrackingScreen._buildPremiumHeader` (Bike/Auto
/// reference implementation). The OTP/ETA row is shown whenever [otp] is
/// non-null and non-empty — callers decide when that's appropriate for
/// their own status machine, exactly like the original `showOtp` gate did.
class TripStatusHeader extends StatelessWidget {
  final String statusLabel;
  final bool showLiveBadge;
  final Widget? trailingActions;
  final String? otp;
  final String? etaMinutes;

  const TripStatusHeader({
    super.key,
    required this.statusLabel,
    this.showLiveBadge = false,
    this.trailingActions,
    this.otp,
    this.etaMinutes,
  });

  @override
  Widget build(BuildContext context) {
    final showOtp = otp != null && otp!.isNotEmpty;
    final eta = etaMinutes ?? '5';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    statusLabel,
                    style: GoogleFonts.poppins(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFF0F172A),
                    ),
                  ),
                  if (showLiveBadge)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Live tracking',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                        Text(
                          '  •  ',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                        Text(
                          'Secure',
                          style: GoogleFonts.poppins(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: JT.primary,
                          ),
                        ),
                        const SizedBox(width: 3),
                        Icon(Icons.verified_user_rounded, size: 12, color: JT.primary),
                      ],
                    ),
                ],
              ),
            ),
            if (trailingActions != null) trailingActions!,
          ],
        ),
        if (showOtp) ...[
          const SizedBox(height: 16),
          Row(
            children: [
              // PIN Card
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: const Color(0xFF6366F1).withValues(alpha: 0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.lock_rounded, color: Color(0xFF6366F1), size: 18),
                      ),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('SECURE PIN',
                              style: GoogleFonts.poppins(
                                  fontSize: 11, fontWeight: FontWeight.w600, color: const Color(0xFF94A3B8))),
                          Text(otp!,
                              style: GoogleFonts.poppins(
                                  fontSize: 22,
                                  fontWeight: FontWeight.w800,
                                  color: const Color(0xFF0F172A),
                                  letterSpacing: 1)),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Wait Time Card
              Expanded(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(
                          color: const Color(0xFF10B981).withValues(alpha: 0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.timer_rounded, color: Color(0xFF10B981), size: 18),
                      ),
                      const SizedBox(width: 12),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('PILOT ARRIVES IN',
                              style: GoogleFonts.poppins(
                                  fontSize: 11, fontWeight: FontWeight.w600, color: const Color(0xFF94A3B8))),
                          Text('$eta MIN',
                              style: GoogleFonts.poppins(
                                  fontSize: 20, fontWeight: FontWeight.w800, color: const Color(0xFF0F172A))),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ],
    );
  }
}
