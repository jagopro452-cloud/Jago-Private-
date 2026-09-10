import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Animated N-step tracker (e.g. "Searching -> Verifying -> Matching").
///
/// Unifies `TrackingScreen._buildSearchStages` /
/// `_buildSearchStageStep` / `_buildSearchStageConnector` (Bike/Auto
/// reference implementation) into a single reusable widget. Cosmetic
/// only — purely reflects [activeStage], no business logic.
class SearchStageStepper extends StatelessWidget {
  /// Each step is (icon, label). Label may contain `\n` for a two-line caption.
  final List<(IconData, String)> steps;
  final int activeStage;
  final Color doneColor;
  final Color activeColor;
  final Color inactiveColor;
  final Color backgroundColor;
  final Color borderColor;

  const SearchStageStepper({
    super.key,
    required this.steps,
    required this.activeStage,
    this.doneColor = const Color(0xFF10B981),
    this.activeColor = const Color(0xFF2C95F1),
    this.inactiveColor = const Color(0xFF9CA3AF),
    this.backgroundColor = const Color(0xFFF8FAFC),
    this.borderColor = const Color(0xFFF0F1F3),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < steps.length; i++) ...[
            _buildStep(
              steps[i].$1,
              steps[i].$2,
              active: i == activeStage,
              done: i < activeStage,
            ),
            if (i != steps.length - 1)
              Expanded(child: _buildConnector(i < activeStage)),
          ],
        ],
      ),
    );
  }

  Widget _buildStep(IconData icon, String label, {required bool active, required bool done}) {
    final color = done ? doneColor : (active ? activeColor : inactiveColor);
    final bg = done
        ? doneColor.withValues(alpha: 0.12)
        : (active ? activeColor.withValues(alpha: 0.12) : const Color(0xFFE5E7EB).withValues(alpha: 0.5));
    return SizedBox(
      width: 58,
      child: Column(
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            width: active ? 28 : 23,
            height: active ? 28 : 23,
            decoration: BoxDecoration(
              color: bg,
              shape: BoxShape.circle,
              border: active ? Border.all(color: color, width: 1.3) : null,
            ),
            child: Icon(done ? Icons.check_rounded : icon, size: active ? 14 : 11, color: color),
          ),
          const SizedBox(height: 5),
          Text(
            label,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              fontSize: 8.5,
              fontWeight: active ? FontWeight.w600 : FontWeight.w500,
              color: active || done ? const Color(0xFF334155) : const Color(0xFF9CA3AF),
              height: 1.15,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildConnector(bool done) {
    return Container(
      margin: const EdgeInsets.only(top: 11, left: 2, right: 2),
      height: 2,
      decoration: BoxDecoration(
        color: done ? doneColor.withValues(alpha: 0.5) : const Color(0xFFE5E7EB),
        borderRadius: BorderRadius.circular(1),
      ),
    );
  }
}
