import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Which single "next action" the driver's Local Pool bottom card is
/// currently fronting. Derived purely from existing session/passenger data —
/// see `_LocalPoolScreenState._poolCardState`.
enum PoolCardState {
  /// Session active, nobody pending/matched/onboard right now.
  idleWaiting,

  /// A passenger is waiting on this driver's Accept/Skip decision.
  newRequestPending,

  /// A matched passenger hasn't been picked up yet.
  headingToPickup,

  /// A picked-up passenger hasn't been dropped yet.
  onboard,

  /// Every passenger in this session has been dropped.
  allDropped,
}

/// The single dynamic bottom card for the driver's Local Pool screen.
///
/// Replaces the old always-stacked session-hero + metrics + sequence-card's
/// "next stop" + per-passenger action button. Renders exactly one state's
/// content — headline plus, where relevant, the one passenger currently in
/// focus (rendered by the caller via [focusedPassengerCard], reusing the
/// screen's existing full passenger-card widget verbatim) — never more than
/// one passenger's action surface at a time. Every other passenger stays
/// reachable via "View All Stops".
class PoolDynamicActionCard extends StatelessWidget {
  final PoolCardState state;
  final int availableSeats;
  final int maxSeats;
  final bool ending;
  final VoidCallback? onEndSession;
  final Widget? focusedPassengerCard;
  final int stopsCount;
  final VoidCallback? onViewAllStops;

  const PoolDynamicActionCard({
    super.key,
    required this.state,
    required this.availableSeats,
    required this.maxSeats,
    required this.ending,
    required this.onEndSession,
    required this.focusedPassengerCard,
    required this.stopsCount,
    required this.onViewAllStops,
  });

  (IconData, Color, String, String) get _headline {
    switch (state) {
      case PoolCardState.idleWaiting:
        return (Icons.hourglass_top_rounded, JT.primary, 'Waiting for passengers', 'Matching is live while seats are available.');
      case PoolCardState.newRequestPending:
        return (Icons.person_add_alt_1_rounded, JT.primary, 'New passenger wants to share your ride', 'Accept to add them to your route.');
      case PoolCardState.headingToPickup:
        return (Icons.navigation_rounded, JT.primary, 'Heading to pickup', 'Verify OTP once the passenger boards.');
      case PoolCardState.onboard:
        return (Icons.groups_rounded, const Color(0xFF16A34A), 'Passenger onboard', 'Drop them off when you arrive.');
      case PoolCardState.allDropped:
        return (Icons.task_alt_rounded, const Color(0xFF16A34A), 'All riders dropped', 'Rate your passengers and end the session when ready.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final (icon, color, title, subtitle) = _headline;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 14, offset: const Offset(0, -2))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(color: color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(12)),
                child: Icon(icon, color: color, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: GoogleFonts.poppins(fontSize: 15, fontWeight: FontWeight.w600, color: JT.textPrimary)),
                    const SizedBox(height: 2),
                    Text(subtitle, style: GoogleFonts.poppins(fontSize: 11.5, color: JT.textSecondary)),
                  ],
                ),
              ),
            ],
          ),
          if (state == PoolCardState.idleWaiting) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: Text(
                    '$availableSeats of $maxSeats seats available',
                    style: GoogleFonts.poppins(fontSize: 13, fontWeight: FontWeight.w500, color: JT.textPrimary),
                  ),
                ),
                OutlinedButton(
                  onPressed: ending ? null : onEndSession,
                  style: OutlinedButton.styleFrom(
                    foregroundColor: JT.error,
                    side: BorderSide(color: JT.error.withValues(alpha: 0.4)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text(ending ? 'Ending...' : 'End Pool', style: GoogleFonts.poppins(fontWeight: FontWeight.w600, fontSize: 12.5)),
                ),
              ],
            ),
          ],
          if (focusedPassengerCard != null) ...[
            const SizedBox(height: 14),
            focusedPassengerCard!,
          ],
          if (state == PoolCardState.allDropped) ...[
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: ending ? null : onEndSession,
                style: ElevatedButton.styleFrom(
                  backgroundColor: JT.primary,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                child: Text(
                  ending ? 'Ending...' : 'End Session',
                  style: GoogleFonts.poppins(color: Colors.white, fontWeight: FontWeight.w600),
                ),
              ),
            ),
          ],
          if (onViewAllStops != null && stopsCount > 0) ...[
            const SizedBox(height: 10),
            Center(
              child: TextButton(
                onPressed: onViewAllStops,
                child: Text(
                  'View All Stops ($stopsCount)',
                  style: GoogleFonts.poppins(fontSize: 12.5, fontWeight: FontWeight.w600, color: JT.primary),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
