import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Compact one-line seat summary ("● ● ○ ○  2/4 occupied") that expands to
/// [PoolSeatSheet] on tap, replacing the always-visible "Seat Occupancy Map"
/// grid that used to sit permanently in the scrolling sheet.
class PoolSeatStrip extends StatelessWidget {
  final int maxSeats;
  final int occupied;
  final VoidCallback onTap;

  const PoolSeatStrip({
    super.key,
    required this.maxSeats,
    required this.occupied,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ...List.generate(maxSeats, (i) {
            final filled = i < occupied;
            return Padding(
              padding: const EdgeInsets.only(right: 3),
              child: Icon(
                filled ? Icons.circle : Icons.circle_outlined,
                size: 10,
                color: filled ? JT.warning : JT.success,
              ),
            );
          }),
          const SizedBox(width: 6),
          Text(
            '$occupied/$maxSeats occupied',
            style: GoogleFonts.poppins(fontSize: 11, fontWeight: FontWeight.w500, color: JT.textSecondary),
          ),
          const SizedBox(width: 2),
          const Icon(Icons.chevron_right_rounded, size: 14, color: JT.textSecondary),
        ],
      ),
    );
  }
}

/// Bottom-sheet detail view opened from [PoolSeatStrip] — the same D/S1..Sn
/// tile grid the old always-visible "Seat Occupancy Map" card used to show.
class PoolSeatSheet extends StatelessWidget {
  final int maxSeats;
  final int occupied;

  const PoolSeatSheet({
    super.key,
    required this.maxSeats,
    required this.occupied,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(color: JT.border, borderRadius: BorderRadius.circular(4)),
              ),
            ),
            const SizedBox(height: 16),
            Text('Seat Occupancy', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600, color: JT.textPrimary)),
            const SizedBox(height: 6),
            Text(
              'Driver seat plus live passenger capacity for this rolling pool session.',
              style: GoogleFonts.poppins(fontSize: 12, color: JT.textSecondary),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                _seatTile('D', 'Driver', JT.primary),
                ...List.generate(maxSeats, (index) {
                  final isOccupied = index < occupied;
                  return _seatTile(
                    'S${index + 1}',
                    isOccupied ? 'Occupied' : 'Open',
                    isOccupied ? JT.warning : JT.success,
                  );
                }),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _seatTile(String label, String subtitle, Color color) {
    return Container(
      width: 78,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Column(
        children: [
          Icon(Icons.event_seat_rounded, size: 18, color: color),
          const SizedBox(height: 6),
          Text(label, style: GoogleFonts.poppins(fontSize: 12, fontWeight: FontWeight.w700, color: JT.textPrimary)),
          const SizedBox(height: 2),
          Text(subtitle, style: GoogleFonts.poppins(fontSize: 10.5, color: JT.textSecondary)),
        ],
      ),
    );
  }
}
