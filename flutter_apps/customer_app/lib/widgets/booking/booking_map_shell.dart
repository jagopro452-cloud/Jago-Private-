import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../../config/jago_theme.dart';
import '../../core/map_night_style.dart';

/// The map + bottom-sheet shell shared by every step-based booking flow —
/// extracted verbatim from [BookingScreen]'s `build()` method (Bike/Auto/Cab/
/// Premium's reference booking screen): a full-screen [GoogleMap] behind a
/// recenter FAB, a floating back-button/title card, a step-progress row, and
/// a draggable-height bottom sheet holding a scrollable step body and a
/// bottom CTA button.
///
/// This widget is purely presentational — it owns no booking state or
/// business logic. Callers (e.g. [BookingScreen], `CarShareOptionsScreen`)
/// supply everything through the constructor and keep their own state
/// machine, API calls, and fare/seat logic untouched.
class BookingMapShell extends StatelessWidget {
  const BookingMapShell({
    super.key,
    required this.pickupLatLng,
    required this.markers,
    required this.polylines,
    required this.onMapCreated,
    required this.onRecenter,
    required this.title,
    this.subtitle = '',
    this.headerExtra,
    required this.totalSteps,
    required this.currentStep,
    required this.sheetMaxHeight,
    required this.stepBody,
    required this.stepBodyKey,
    required this.ctaLabel,
    required this.onCtaPressed,
    this.ctaLoading = false,
    this.ctaTrailingIcon,
    this.belowCta,
    this.onBack,
  });

  /// Camera target for the map's [CameraPosition.target] on first build.
  final LatLng pickupLatLng;

  /// Full marker set to render (pickup/drop pins, live nearby-driver
  /// markers, etc.) — composed entirely by the caller.
  final Set<Marker> markers;

  /// Route polyline(s) to render — composed entirely by the caller.
  final Set<Polyline> polylines;

  /// Fired once the underlying [GoogleMapController] is ready.
  final void Function(GoogleMapController) onMapCreated;

  /// Fired when the recenter FAB (bottom-right, "my_location" icon) is tapped.
  final VoidCallback onRecenter;

  /// Floating header card title (bold, 15px).
  final String title;

  /// Floating header card subtitle (11px, secondary) — omitted when empty.
  final String subtitle;

  /// Optional extra content rendered below the title/subtitle inside the
  /// header card (e.g. BookingScreen's "For me / For else" toggle).
  final Widget? headerExtra;

  /// Number of segments drawn in the step-progress bar.
  final int totalSteps;

  /// Zero-based index of the currently active step.
  final int currentStep;

  /// Max height of the bottom sheet — callers vary this per-step exactly as
  /// BookingScreen's build() does (`_bookingStep == farePayment ? h*0.5 : 360`).
  final double sheetMaxHeight;

  /// The step-specific scrollable content, already built (and already
  /// wrapped in the caller's own error handling, if any) by the caller.
  final Widget stepBody;

  /// Seed for the CTA row's [ValueKey] so the [AnimatedSwitcher] swap fires
  /// exactly when the caller's step actually changes (e.g. pass the step
  /// enum's `.name`).
  final Object stepBodyKey;

  /// CTA button label (ignored while [ctaLoading] is true, which shows a
  /// spinner instead).
  final String ctaLabel;

  /// CTA button tap handler. The button is disabled whenever this is null
  /// OR [ctaLoading] is true — same rule BookingScreen's Confirm button used.
  final VoidCallback? onCtaPressed;

  /// When true, the CTA button shows a spinner and is disabled.
  final bool ctaLoading;

  /// Optional trailing icon shown after the CTA label (e.g. the arrow-forward
  /// BookingScreen shows on its farePayment step once fare/estimate settle).
  final Widget? ctaTrailingIcon;

  /// Optional content rendered below the CTA button (e.g. BookingScreen's
  /// "Secure payments" lock note).
  final Widget? belowCta;

  /// Back-button tap handler — defaults to `Navigator.pop(context)`.
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(
          child: GoogleMap(
            initialCameraPosition: CameraPosition(target: pickupLatLng, zoom: 14),
            style: Theme.of(context).brightness == Brightness.dark ? kMapNightStyle : null,
            onMapCreated: onMapCreated,
            markers: markers,
            polylines: polylines,
            zoomControlsEnabled: false,
            myLocationButtonEnabled: false,
            mapToolbarEnabled: false,
            compassEnabled: false,
            padding: EdgeInsets.only(
              bottom: sheetMaxHeight + 20,
              top: 104,
            ),
          ),
        ),
        Positioned(
          right: 16,
          bottom: sheetMaxHeight + 56,
          child: GestureDetector(
            onTap: onRecenter,
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: JT.cardShadow,
              ),
              child: const Icon(Icons.my_location_rounded, color: JT.primary, size: 20),
            ),
          ),
        ),
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      GestureDetector(
                        onTap: onBack ?? () => Navigator.pop(context),
                        child: Container(
                          width: 48,
                          height: 48,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(16),
                            boxShadow: JT.cardShadow,
                          ),
                          child: const Icon(Icons.arrow_back_rounded, color: JT.textPrimary),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            boxShadow: JT.cardShadow,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                title,
                                style: GoogleFonts.poppins(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                  color: JT.textPrimary,
                                ),
                              ),
                              if (subtitle.isNotEmpty) ...[
                                const SizedBox(height: 3),
                                Text(
                                  subtitle,
                                  style: GoogleFonts.poppins(
                                    fontSize: 11,
                                    color: JT.textSecondary,
                                  ),
                                ),
                              ],
                              if (headerExtra != null) ...[
                                const SizedBox(height: 8),
                                headerExtra!,
                              ],
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _StepProgressBar(totalSteps: totalSteps, currentStep: currentStep),
                ],
              ),
            ),
          ),
        ),
        Align(
          alignment: Alignment.bottomCenter,
          child: Container(
            constraints: BoxConstraints(maxHeight: sheetMaxHeight),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
              boxShadow: [BoxShadow(color: Color(0x22000000), blurRadius: 24)],
            ),
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Center(child: _SheetHandle()),
                    const SizedBox(height: 16),
                    Expanded(child: stepBody),
                    const SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      height: 56,
                      child: ElevatedButton(
                        onPressed: ctaLoading ? null : onCtaPressed,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: JT.primary,
                          foregroundColor: Colors.white,
                          disabledBackgroundColor: JT.border,
                          disabledForegroundColor: JT.textSecondary,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                          elevation: 0,
                        ),
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 220),
                          transitionBuilder: (child, animation) => FadeTransition(
                            opacity: animation,
                            child: ScaleTransition(
                              scale: Tween<double>(
                                begin: 0.98,
                                end: 1,
                              ).animate(animation),
                              child: child,
                            ),
                          ),
                          child: ctaLoading
                              ? const SizedBox(
                                  key: ValueKey('booking_shell_loading'),
                                  width: 22,
                                  height: 22,
                                  child: CircularProgressIndicator(
                                    color: Colors.white,
                                    strokeWidth: 2.4,
                                  ),
                                )
                              : Row(
                                  key: ValueKey('booking_shell_$stepBodyKey'),
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Text(
                                      ctaLabel,
                                      style: GoogleFonts.poppins(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                    if (ctaTrailingIcon != null) ...[
                                      const SizedBox(width: 8),
                                      ctaTrailingIcon!,
                                    ],
                                  ],
                                ),
                        ),
                      ),
                    ),
                    if (belowCta != null) ...[
                      const SizedBox(height: 10),
                      belowCta!,
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _StepProgressBar extends StatelessWidget {
  const _StepProgressBar({required this.totalSteps, required this.currentStep});

  final int totalSteps;
  final int currentStep;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: JT.cardShadow,
      ),
      child: Row(
        children: List.generate(totalSteps, (index) {
          final isDone = index < currentStep;
          final isActive = index == currentStep;
          return Expanded(
            child: Row(
              children: [
                Expanded(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 220),
                    height: 6,
                    decoration: BoxDecoration(
                      color: isDone || isActive ? JT.primary : JT.border,
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                ),
                if (index < totalSteps - 1) const SizedBox(width: 6),
              ],
            ),
          );
        }),
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      width: 44,
      height: 4,
      decoration: BoxDecoration(
        color: JT.border,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}
