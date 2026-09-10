import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../config/jago_theme.dart';

/// Rationale shown before requesting the "display over other apps" permission.
/// Purely explanatory — the driver must explicitly grant it in Settings.
class FloatingIconPermissionSheet extends StatelessWidget {
  final VoidCallback onAllow;
  const FloatingIconPermissionSheet({super.key, required this.onAllow});

  static Future<void> show(BuildContext context, {required VoidCallback onAllow}) {
    return showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => FloatingIconPermissionSheet(onAllow: onAllow),
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
              child: const Icon(Icons.circle, color: JT.primary, size: 26),
            ),
            const SizedBox(height: 16),
            Text(
              'Floating Ride Icon',
              style: GoogleFonts.poppins(fontSize: 18, fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 8),
            Text(
              'Allow Jago to display a small floating icon while you use other apps during an active ride.',
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
                child: const Text('Allow Floating Icon'),
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
