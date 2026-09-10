import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// One seat slot's derived (client-side only — no backend seat-number
/// concept exists) occupant for [PoolSeatSelectorStrip].
class PoolSeatSlot {
  final Map<String, dynamic>? passenger;

  const PoolSeatSlot(this.passenger);

  bool get isEmpty => passenger == null;
  String get status => passenger?['status']?.toString() ?? '';
  String get name => passenger?['customer_name']?.toString() ?? 'Passenger';
}

/// Row of tappable seat cards shown directly under the Local Pool header —
/// "Seat 1: Siva", "Seat 2: Rahul", "Seat 3: Empty" etc. Tapping an occupied
/// seat re-focuses the map + bottom sheet on that passenger; empty seats are
/// inert (there is no passenger to show).
class PoolSeatSelectorStrip extends StatelessWidget {
  final List<PoolSeatSlot> slots;
  final int selectedIndex;
  final ValueChanged<int> onSeatTap;

  const PoolSeatSelectorStrip({
    super.key,
    required this.slots,
    required this.selectedIndex,
    required this.onSeatTap,
  });

  Color _statusColor(String status) {
    switch (status) {
      case 'pending_driver_accept':
        return const Color(0xFFF97316); // amber — awaiting accept
      case 'picked_up':
        return JT.success; // onboard
      case 'matched':
      default:
        return JT.primary; // heading to pickup
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Row(
        children: List.generate(slots.length, (index) {
          final slot = slots[index];
          final selected = index == selectedIndex && !slot.isEmpty;
          final occupantColor = slot.isEmpty ? JT.textSecondary : _statusColor(slot.status);
          return Padding(
            padding: EdgeInsets.only(right: index == slots.length - 1 ? 0 : 10),
            child: InkWell(
              onTap: slot.isEmpty ? null : () => onSeatTap(index),
              borderRadius: BorderRadius.circular(16),
              child: Container(
                width: 118,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: selected ? JT.primary.withValues(alpha: 0.07) : Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: selected ? JT.primary : JT.border,
                    width: selected ? 1.6 : 1,
                  ),
                ),
                child: Row(
                  children: [
                    Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Container(
                          width: 30,
                          height: 30,
                          decoration: BoxDecoration(
                            color: occupantColor.withValues(alpha: slot.isEmpty ? 0.10 : 0.16),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            slot.isEmpty ? Icons.person_outline_rounded : Icons.person_rounded,
                            size: 17,
                            color: occupantColor,
                          ),
                        ),
                        if (!slot.isEmpty)
                          Positioned(
                            right: -1,
                            bottom: -1,
                            child: Container(
                              width: 9,
                              height: 9,
                              decoration: BoxDecoration(
                                color: occupantColor,
                                shape: BoxShape.circle,
                                border: Border.all(color: Colors.white, width: 1.5),
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('Seat ${index + 1}',
                              style: GoogleFonts.poppins(
                                  fontSize: 11.5, fontWeight: FontWeight.w700, color: JT.textPrimary)),
                          Text(
                            slot.isEmpty ? 'Empty' : slot.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: GoogleFonts.poppins(
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                              color: slot.isEmpty ? JT.textSecondary : occupantColor,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }
}
