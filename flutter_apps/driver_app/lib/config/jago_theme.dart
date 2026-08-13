// ══════════════════════════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY MODULE
// This file re-exports the modern app_theme.dart AppColors as JT for convenient 
// access throughout the driver app during gradual migration.
// ══════════════════════════════════════════════════════════════════════════════

export 'app_theme.dart' show AppColors, AppText, AppCard, AppGlow, AppButton, AppInputs, AppSpacing, AppAnimation;

import 'package:flutter/material.dart';
import 'app_theme.dart';

// ── Legacy JT class (compatibility wrapper around modern AppColors) ────────
class JT {
  // THEME COLORS — Clean Blue + White (mapped from AppColors)
  static const Color primary     = AppColors.primary;       // #2D8CFF blue
  static const Color primaryLight = AppColors.primaryLight; // #E8F2FF light variant
  static const Color primaryDark  = AppColors.primaryDark;  // #1A6FDB dark variant
  static const Color secondary   = AppColors.secondary;     // #5BABFF light blue
  static const Color bg          = AppColors.bg;            // #FFFFFF white
  static const Color bgSoft      = AppColors.surface;       // #F8FAFE soft surface
  static const Color surface     = AppColors.surface;       // #F8FAFE
  static const Color surfaceAlt  = AppColors.cardAlt;       // #F3F7FF blue-tinted
  static const Color border      = AppColors.border;        // #E5E9F0
  static const Color textPrimary = AppColors.textPrimary;   // #111827 dark
  static const Color textSecondary = AppColors.textSecondary; // #6B7280
  static const Color iconInactive  = AppColors.textTertiary;   // #9CA3AF
  static const Color error   = AppColors.error;             // #DC2626
  static const Color success = AppColors.success;           // #16A34A
  static const Color warning = AppColors.warning;           // #F59E0B

  // GRADIENTS — Same as app_theme
  static LinearGradient get grad => AppColors.neonGrad;
  static LinearGradient get gradReverse => AppColors.neonGradReverse;

  // SHADOWS & GLOWS — Mapped from AppGlow premium system
  static List<BoxShadow> get cardShadow => AppGlow.softSmall();
  static List<BoxShadow> get btnShadow => AppGlow.neon(AppColors.primary, blur: 16);

  // TEXT STYLES — Mapped from modern AppText
  static TextStyle get h1 => AppText.h1(null);
  static TextStyle get h2 => AppText.h2(null);
  static TextStyle get h3 => AppText.h3(null);
  static TextStyle get h4 => AppText.h4(null);
  static TextStyle get body => AppText.body(null);
  static TextStyle get bodyPrimary => AppText.bodyPrimary(null);
  static TextStyle get caption => AppText.caption(null);
  static TextStyle get btnText => AppText.btnText();

  // HELPER COMPONENT
  static Widget gradientButton({
    required String label,
    required VoidCallback onTap,
    bool loading = false,
    double height = 56,
  }) {
    return AppButton.neonGradient(
      label: label,
      onTap: onTap,
      loading: loading,
      height: height,
      neonColor: AppColors.primary,
    );
  }

  // LOGOS — Pilot branding
  static Widget logoBlue({double height = 36}) =>
      ColorFiltered(
        colorFilter: const ColorFilter.mode(Color(0xFF2D8CFF), BlendMode.srcIn),
        child: Image.asset('assets/images/pilot_logo_white.png', height: height, fit: BoxFit.contain),
      );

  static Widget logoPilot({double height = 36}) =>
      ColorFiltered(
        colorFilter: const ColorFilter.mode(Color(0xFF2D8CFF), BlendMode.srcIn),
        child: Image.asset('assets/images/pilot_logo_white.png', height: height, fit: BoxFit.contain),
      );

  static Widget logoWhite({double height = 36}) =>
      Image.asset('assets/images/pilot_logo_white.png', height: height, fit: BoxFit.contain);
}

