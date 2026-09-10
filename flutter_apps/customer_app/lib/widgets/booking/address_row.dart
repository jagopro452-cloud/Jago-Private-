import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';

/// A single pickup/drop address line: a colored circular badge holding
/// [icon], a small "PICKUP"/"DROP" tag, and the address text — used inside
/// the route card on both [BookingScreen]'s route step and Car Share's trip
/// summary card. Extracted verbatim from `BookingScreen._addressRow` (the
/// original inferred pickup-vs-drop by checking `icon == Icons.circle_rounded`;
/// this widget takes [isPickup] explicitly instead so callers don't have to
/// rely on that icon-sniffing).
class AddressRow extends StatelessWidget {
  const AddressRow({
    super.key,
    required this.icon,
    required this.color,
    required this.text,
    required this.isPickup,
    this.textColor,
  });

  final IconData icon;
  final Color color;
  final String text;
  final bool isPickup;
  final Color? textColor;

  @override
  Widget build(BuildContext context) {
    final tColor = textColor ?? JT.textPrimary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
        Container(
          width: 28, height: 28,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.1),
            shape: BoxShape.circle,
            border: Border.all(color: color.withValues(alpha: 0.3), width: 1.5),
          ),
          child: Icon(icon, color: color, size: isPickup ? 10 : 16),
        ),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(isPickup ? 'PICKUP' : 'DROP',
            style: TextStyle(fontSize: 9, fontWeight: FontWeight.w500, color: color.withValues(alpha: 0.8), letterSpacing: 0.8)),
          const SizedBox(height: 2),
          Text(text,
            style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: tColor),
            maxLines: 1, overflow: TextOverflow.ellipsis),
        ])),
      ]),
    );
  }
}
