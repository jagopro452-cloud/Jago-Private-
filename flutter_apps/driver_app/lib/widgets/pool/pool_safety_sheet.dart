import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Bottom sheet for Local Pool safety actions, opened from a single small
/// safety pill floated over the map — replaces the old permanently-visible
/// "Pool Safety & Share" card.
class PoolSafetySheet extends StatelessWidget {
  final Future<void> Function() onSos;
  final Future<void> Function()? onShareFirstRider;
  final VoidCallback onEmergencyContact;
  final VoidCallback onReport;

  const PoolSafetySheet({
    super.key,
    required this.onSos,
    required this.onShareFirstRider,
    required this.onEmergencyContact,
    required this.onReport,
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
            Text('Pool Safety & Share', style: GoogleFonts.poppins(fontSize: 16, fontWeight: FontWeight.w600, color: JT.textPrimary)),
            const SizedBox(height: 14),
            _row(
              context,
              icon: Icons.sos_rounded,
              label: 'Pool SOS',
              color: JT.error,
              onTap: () async {
                Navigator.pop(context);
                await onSos();
              },
            ),
            if (onShareFirstRider != null)
              _row(
                context,
                icon: Icons.share_outlined,
                label: 'Share Ride Details',
                color: JT.primary,
                onTap: () async {
                  Navigator.pop(context);
                  await onShareFirstRider!();
                },
              ),
            _row(
              context,
              icon: Icons.contact_phone_rounded,
              label: 'Emergency Contact',
              color: JT.primary,
              onTap: () {
                Navigator.pop(context);
                onEmergencyContact();
              },
            ),
            _row(
              context,
              icon: Icons.report_gmailerrorred_rounded,
              label: 'Report an Issue',
              color: JT.primary,
              onTap: () {
                Navigator.pop(context);
                onReport();
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(
    BuildContext context, {
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(color: color.withValues(alpha: 0.10), borderRadius: BorderRadius.circular(11)),
              child: Icon(icon, color: color, size: 18),
            ),
            const SizedBox(width: 12),
            Text(label, style: GoogleFonts.poppins(fontSize: 14, fontWeight: FontWeight.w500, color: JT.textPrimary)),
          ],
        ),
      ),
    );
  }
}
