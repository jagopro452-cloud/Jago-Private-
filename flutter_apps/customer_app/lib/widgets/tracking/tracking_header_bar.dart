import 'package:flutter/material.dart';

/// Custom top navigation row used at the top of tracking screens — a
/// `SafeArea`-padded row with a leading slot (Bike/Auto passes its logo,
/// a back-navigable screen passes an `IconButton`) and a row of trailing
/// action widgets.
///
/// Extracted verbatim (layout/padding) from the top of
/// `TrackingScreen.build()` (Bike/Auto reference implementation).
class TrackingHeaderBar extends StatelessWidget {
  final Widget leading;
  final List<Widget> actions;
  final double actionSpacing;

  const TrackingHeaderBar({
    super.key,
    required this.leading,
    this.actions = const [],
    this.actionSpacing = 12,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            leading,
            Row(
              children: [
                for (int i = 0; i < actions.length; i++) ...[
                  if (i != 0) SizedBox(width: actionSpacing),
                  actions[i],
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
