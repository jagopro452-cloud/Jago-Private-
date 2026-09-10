import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Data for a single chip in a [CompletionHighlightRow].
class CompletionHighlightItem {
  final IconData icon;
  final String label;
  final String value;
  final Color accent;

  const CompletionHighlightItem({
    required this.icon,
    required this.label,
    required this.value,
    required this.accent,
  });
}

/// Row of highlight chips (e.g. ride status, fare, distance, seats) shown on
/// trip/ride completion screens.
class CompletionHighlightRow extends StatelessWidget {
  final List<CompletionHighlightItem> items;

  const CompletionHighlightRow({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (int i = 0; i < items.length; i++) ...[
          if (i > 0) const SizedBox(width: 12),
          _chip(items[i]),
        ],
      ],
    );
  }

  Widget _chip(CompletionHighlightItem item) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              Colors.white,
              item.accent.withValues(alpha: 0.06),
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: item.accent.withValues(alpha: 0.14)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: item.accent.withValues(alpha: 0.10),
                shape: BoxShape.circle,
              ),
              child: Icon(item.icon, size: 16, color: item.accent),
            ),
            const SizedBox(height: 10),
            Text(
              item.label,
              style: GoogleFonts.poppins(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF94A3B8),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              item.value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: GoogleFonts.poppins(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: const Color(0xFF0F172A),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
