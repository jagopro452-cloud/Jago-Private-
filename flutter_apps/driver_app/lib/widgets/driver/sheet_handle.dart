import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';

/// Small pill-shaped drag-handle bar shown at the top of a bottom sheet.
///
/// Both `TripScreen` and `LocalPoolScreen` used to define their own
/// near-identical private handle widget/method — this unifies them. Purely
/// decorative on its own; wrap it in a `GestureDetector` (see
/// `DraggableMapSheet`'s `onHandleDragUpdate`) to make it drag-interactive.
class SheetHandle extends StatelessWidget {
  final double width;
  final double height;
  final Color? color;
  final double? radius;

  const SheetHandle({
    super.key,
    this.width = 44,
    this.height = 4,
    this.color,
    this.radius,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: color ?? JT.border,
        borderRadius: BorderRadius.circular(radius ?? (height / 2)),
      ),
    );
  }
}
