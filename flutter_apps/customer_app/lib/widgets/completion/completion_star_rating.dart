import 'package:flutter/material.dart';

/// Interactive 5-star rating row used on trip/ride completion & rating
/// screens. Purely presentational — callers own the rated value and any
/// submission logic.
class CompletionStarRating extends StatelessWidget {
  final int rated;
  final ValueChanged<int> onRate;

  const CompletionStarRating({
    super.key,
    required this.rated,
    required this.onRate,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: const Color(0xFFFCFCFF),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(5, (index) {
          final starIndex = index + 1;
          final isFilled = starIndex <= rated;
          return GestureDetector(
            onTap: () => onRate(starIndex),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Icon(
                isFilled ? Icons.star_rounded : Icons.star_outline_rounded,
                size: 40,
                color:
                    isFilled ? const Color(0xFFFFB800) : const Color(0xFFE2E8F0),
              ),
            ),
          );
        }),
      ),
    );
  }
}
