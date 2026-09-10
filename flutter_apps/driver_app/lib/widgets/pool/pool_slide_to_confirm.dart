import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../config/jago_theme.dart';

/// Modern "slide to confirm" control — mirrors the drag mechanic already
/// used for payment collection in TripScreen (`_paymentSlideTile`), just
/// packaged as a reusable, self-contained widget so it can also be used for
/// Local Pool's "Slide to mark as arrived" / "Slide to drop passenger"
/// actions without duplicating that drag-gesture logic.
///
/// [onConfirmed] is awaited — the handle shows a small spinner and the track
/// is disabled while it runs, then resets. Pass a fresh [key] (e.g. keyed by
/// requestId+status) when the underlying action changes, so old drag state
/// never carries over onto a different passenger/action.
class PoolSlideToConfirm extends StatefulWidget {
  final String label;
  final IconData icon;
  final Color color;
  final Future<void> Function() onConfirmed;

  const PoolSlideToConfirm({
    super.key,
    required this.label,
    required this.onConfirmed,
    this.icon = Icons.arrow_forward_rounded,
    this.color = JT.primary,
  });

  @override
  State<PoolSlideToConfirm> createState() => _PoolSlideToConfirmState();
}

class _PoolSlideToConfirmState extends State<PoolSlideToConfirm> {
  double _offset = 0;
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    const handleSize = 56.0;
    return LayoutBuilder(builder: (context, constraints) {
      final maxSlide = (constraints.maxWidth - handleSize - 8).clamp(0.0, double.infinity);
      return Container(
        height: handleSize + 8,
        decoration: BoxDecoration(
          color: widget.color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular((handleSize + 8) / 2),
          border: Border.all(color: widget.color.withValues(alpha: 0.22)),
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Center(
              child: Text(
                widget.label,
                style: GoogleFonts.poppins(color: widget.color, fontWeight: FontWeight.w600, fontSize: 13.5),
              ),
            ),
            AnimatedPositioned(
              duration: _offset == 0 ? const Duration(milliseconds: 220) : Duration.zero,
              curve: Curves.easeOut,
              left: 4 + _offset.clamp(0, maxSlide),
              top: 4,
              child: GestureDetector(
                onHorizontalDragUpdate: _busy
                    ? null
                    : (d) => setState(() => _offset = (_offset + d.delta.dx).clamp(0, maxSlide)),
                onHorizontalDragEnd: _busy
                    ? null
                    : (_) async {
                        if (maxSlide > 0 && _offset >= maxSlide * 0.82) {
                          HapticFeedback.heavyImpact();
                          setState(() {
                            _busy = true;
                          });
                          try {
                            await widget.onConfirmed();
                          } finally {
                            if (mounted) setState(() => _busy = false);
                          }
                        }
                        if (mounted) setState(() => _offset = 0);
                      },
                child: Container(
                  width: handleSize,
                  height: handleSize,
                  decoration: BoxDecoration(
                    color: widget.color,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(color: widget.color.withValues(alpha: 0.35), blurRadius: 12, offset: const Offset(0, 4)),
                    ],
                  ),
                  child: _busy
                      ? const Padding(
                          padding: EdgeInsets.all(16),
                          child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                        )
                      : Icon(widget.icon, color: Colors.white, size: 24),
                ),
              ),
            ),
          ],
        ),
      );
    });
  }
}
