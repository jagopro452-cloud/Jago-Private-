import 'package:flutter/material.dart';

/// Pulsing radar-style icon that signals an active, ongoing search.
///
/// Extracted verbatim from `TrackingScreen._buildSearchPulseIcon` (Bike/Auto
/// reference implementation). The [controller] is owned by the parent
/// screen — this widget never creates or disposes its own
/// [AnimationController], it only listens to the one it's given.
class SearchPulseIcon extends StatelessWidget {
  final AnimationController controller;
  final Color color;
  final IconData icon;
  final double size;
  final double innerSize;
  final double iconSize;

  const SearchPulseIcon({
    super.key,
    required this.controller,
    this.color = const Color(0xFF2C95F1),
    this.icon = Icons.search_rounded,
    this.size = 36,
    this.innerSize = 32,
    this.iconSize = 16,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: AnimatedBuilder(
        animation: controller,
        builder: (context, child) {
          final t = controller.value;
          return Stack(
            alignment: Alignment.center,
            children: [
              Transform.scale(
                scale: 1 + t * 0.6,
                child: Opacity(
                  opacity: (1 - t).clamp(0.0, 1.0) * 0.35,
                  child: Container(
                    width: innerSize,
                    height: innerSize,
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                    ),
                  ),
                ),
              ),
              child!,
            ],
          );
        },
        child: Container(
          width: innerSize,
          height: innerSize,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.12),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: color, size: iconSize),
        ),
      ),
    );
  }
}
