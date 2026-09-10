import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// One row in a [TripMoreMenuButton]'s popup menu.
class MoreMenuAction {
  final IconData icon;
  final String label;
  final Color color;
  final Color? iconColor;
  final VoidCallback onTap;

  const MoreMenuAction({
    required this.icon,
    required this.label,
    required this.color,
    this.iconColor,
    required this.onTap,
  });
}

/// The circular "more" (⋮) icon button + popup menu shown in the trip
/// status header.
///
/// Extracted verbatim from `TrackingScreen._buildMoreMenuButton` (Bike/Auto
/// reference implementation). Callers supply the full ordered list of
/// [actions] — e.g. conditionally including a "Cancel Ride" entry only
/// when cancellation is currently allowed, exactly like the original did.
class TripMoreMenuButton extends StatelessWidget {
  final List<MoreMenuAction> actions;

  const TripMoreMenuButton({super.key, required this.actions});

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<int>(
      tooltip: '',
      padding: EdgeInsets.zero,
      offset: const Offset(0, 44),
      elevation: 6,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      icon: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          shape: BoxShape.circle,
        ),
        child: const Icon(Icons.more_vert_rounded, size: 18, color: Color(0xFF475569)),
      ),
      onSelected: (index) => actions[index].onTap(),
      itemBuilder: (context) => [
        for (int i = 0; i < actions.length; i++)
          PopupMenuItem(
            value: i,
            child: Row(children: [
              Icon(actions[i].icon, size: 18, color: actions[i].iconColor ?? actions[i].color),
              const SizedBox(width: 10),
              Text(actions[i].label,
                  style: GoogleFonts.poppins(
                      fontSize: 13, fontWeight: FontWeight.w500, color: actions[i].color)),
            ]),
          ),
      ],
    );
  }
}
