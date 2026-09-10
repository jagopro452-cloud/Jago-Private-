import 'package:flutter/material.dart';

/// Small solid dot used next to "Trip is in progress"-style live-status text.
///
/// Extracted verbatim from `TrackingScreen._buildLiveDot` (Bike/Auto
/// reference implementation).
class LiveDot extends StatelessWidget {
  final double size;
  final Color color;

  const LiveDot({super.key, this.size = 8, this.color = Colors.red});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}
