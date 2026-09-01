import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/jago_theme.dart';

/// Rationale shown before asking the driver to exempt Jago from battery
/// optimization, so incoming ride/parcel offers reliably wake the app while
/// backgrounded. The driver must explicitly grant it in Settings.
class BatteryOptimizationSheet extends StatelessWidget {
  final VoidCallback onAllow;
  const BatteryOptimizationSheet({super.key, required this.onAllow});

  static Future<void> show(BuildContext context, {required VoidCallback onAllow}) {
    return showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => BatteryOptimizationSheet(onAllow: onAllow),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Container(
        margin: const EdgeInsets.all(16),
        padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: JT.primary.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.notifications_active_rounded, color: JT.primary, size: 26),
            ),
            const SizedBox(height: 16),
            Text(
              "Don't Miss Ride Requests",
              style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              'Some phones stop Jago in the background and block new ride/parcel alerts. Allow Jago to run without battery restrictions so you never miss a request while online.',
              textAlign: TextAlign.center,
              style: GoogleFonts.poppins(fontSize: 14, color: const Color(0xFF64748B)),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.of(context).pop();
                  onAllow();
                },
                child: const Text('Allow'),
              ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text('Not now', style: GoogleFonts.poppins(color: const Color(0xFF94A3B8))),
            ),
          ],
        ),
      ),
    );
  }
}
