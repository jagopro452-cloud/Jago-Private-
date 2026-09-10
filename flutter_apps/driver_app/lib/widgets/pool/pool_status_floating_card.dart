import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';
import 'pool_seat_strip.dart';

/// Compact status card floated over the Local Pool map, replacing the old
/// full-width "Shared route live" box + separate "Accepting new passengers"
/// card. Folds rider count, the accepting toggle, and the seat strip into
/// one small surface so the map stays the dominant element on screen.
class PoolStatusFloatingCard extends StatelessWidget {
  final int ridersCount;
  final bool accepting;
  final bool updatingAccepting;
  final ValueChanged<bool>? onToggleAccepting;
  final int maxSeats;
  final int occupiedSeats;
  final VoidCallback onSeatTap;

  const PoolStatusFloatingCard({
    super.key,
    required this.ridersCount,
    required this.accepting,
    required this.updatingAccepting,
    required this.onToggleAccepting,
    required this.maxSeats,
    required this.occupiedSeats,
    required this.onSeatTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.10), blurRadius: 16, offset: const Offset(0, 6)),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(color: Color(0xFF16A34A), shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'Carpool active',
                      style: GoogleFonts.poppins(fontSize: 13.5, fontWeight: FontWeight.w600, color: JT.textPrimary),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  '$ridersCount ${ridersCount == 1 ? 'rider' : 'riders'}',
                  style: GoogleFonts.poppins(fontSize: 11.5, color: JT.textSecondary),
                ),
                const SizedBox(height: 8),
                PoolSeatStrip(maxSeats: maxSeats, occupied: occupiedSeats, onTap: onSeatTap),
              ],
            ),
          ),
          const SizedBox(width: 10),
          updatingAccepting
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2, color: JT.primary),
                )
              : Switch(
                  value: accepting,
                  activeThumbColor: JT.primary,
                  onChanged: onToggleAccepting,
                ),
        ],
      ),
    );
  }
}
