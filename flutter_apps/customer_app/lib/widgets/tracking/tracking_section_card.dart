import 'package:flutter/material.dart';
import '../../config/jago_theme.dart';

/// Thin wrapper reproducing the app's standard card decoration
/// (`JT.cardStyle` — see `config/jago_theme.dart`), so every card on a
/// tracking screen shares the exact same radius/border/shadow instead of
/// each screen inventing its own ad hoc `_card()` helper with slightly
/// different values.
class TrackingSectionCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;
  final BoxDecoration? decoration;

  const TrackingSectionCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.decoration,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding,
      decoration: decoration ?? JT.cardStyle,
      child: child,
    );
  }
}
